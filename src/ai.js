// Who plays the partner and the suspects.
//
//   LEDGER_AI=anthropic    Claude through the Anthropic API (needs ANTHROPIC_API_KEY)
//   LEDGER_AI=claude-code  the local Claude Code CLI in print mode, no API key
//   LEDGER_AI=scripted     no model at all: fixed rules for the partner, fixed lines for suspects
//
// The partner's only tools are the ones the reader lists over MCP. This module
// never sees PayPal credentials; it hands tool calls to `callTool`, which goes to
// the reader process.

import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedPartner, scriptedSuspect } from '../case/scripted.js';

export function chooseBackend(env = process.env) {
  const kind = env.LEDGER_AI ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : 'scripted');
  if (kind === 'anthropic') return anthropicBackend(env);
  if (kind === 'claude-code') return claudeCodeBackend(env);
  if (kind === 'scripted') return scriptedBackend();
  throw new Error(`Unknown LEDGER_AI=${kind}; use anthropic, claude-code or scripted.`);
}

const textOf = (content) =>
  content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

function anthropicBackend(env) {
  const client = new Anthropic();
  const model = env.ANTHROPIC_MODEL ?? 'claude-opus-5-5';
  // On a policy decline the API re-runs the request on a fallback model it picks.
  // The tool list and instructions repeat on every step, so cache the prefix.
  const base = { model, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', cache_control: { type: 'ephemeral' } };

  return {
    name: `anthropic (${model})`,

    // `messages` is this conversation's history; it is appended to, never edited.
    async partnerTurn({ system, messages, tools, callTool }) {
      const apiTools = tools.map(({ name, description, inputSchema }) => {
        const { $schema, ...input_schema } = inputSchema;
        return { name, description, input_schema };
      });
      const calls = [];
      const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      const add = (u = {}) => { for (const k of Object.keys(usage)) usage[k] += u[k] ?? 0; };
      for (let step = 0; step < 16; step++) {
        const response = await client.beta.messages.create({
          ...base,
          output_config: { effort: 'medium' },
          system,
          tools: apiTools,
          messages,
        });
        add(response.usage);
        messages.push({ role: 'assistant', content: response.content });
        if (response.stop_reason === 'refusal') return { reply: textOf(response.content) || '(The partner declined to answer that.)', calls, usage };
        if (response.stop_reason === 'pause_turn') continue;
        if (response.stop_reason !== 'tool_use') return { reply: textOf(response.content), calls, usage };
        const results = [];
        for (const block of response.content.filter((b) => b.type === 'tool_use')) {
          const out = await callTool(block.name, block.input);
          calls.push({ name: block.name, args: block.input, ok: !out.isError });
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out.text, is_error: out.isError });
        }
        messages.push({ role: 'user', content: results });
      }
      return { reply: '(The partner stopped after too many lookups. Ask a narrower question.)', calls, usage };
    },

    async suspectTurn({ system, messages }) {
      const response = await client.beta.messages.create({ ...base, output_config: { effort: 'low' }, system, messages });
      messages.push({ role: 'assistant', content: response.content });
      return { reply: textOf(response.content) || '...', usage: response.usage };
    },
  };
}

// Claude Code in print mode, with every built-in tool removed and only the
// reader's MCP server configured. Each conversation keeps its own session id.
function claudeCodeBackend(env) {
  const model = env.LEDGER_CLAUDE_MODEL ?? 'opus';
  const bin = env.LEDGER_CLAUDE_BIN ?? findClaude(env);
  let workdir;
  let turn = 0;

  async function run({ system, prompt, session, mcpUrl, allowed }) {
    workdir ??= await mkdtemp(join(tmpdir(), 'ledger-case-'));
    const systemFile = join(workdir, `system-${++turn}.txt`);
    await writeFile(systemFile, system);
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--restricted', '--tools', '', '--strict-mcp-config', '--model', model, '--system-prompt-file', systemFile];
    if (mcpUrl) {
      const config = join(workdir, 'mcp.json');
      await writeFile(config, JSON.stringify({ mcpServers: { paypal: { type: 'http', url: mcpUrl } } }));
      args.push('--mcp-config', config, '--allowedTools', allowed.map((n) => `mcp__paypal__${n}`).join(','));
    }
    if (session.id) args.push('--resume', session.id);
    const child = spawn(bin, args, { cwd: workdir, env, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end(prompt);
    const calls = [];
    let reply = '';
    let usage = null;
    let buffer = '';
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d));
    for await (const chunk of child.stdout) {
      buffer += chunk;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let event;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }
        if (event.session_id) session.id = event.session_id;
        if (event.type === 'assistant') {
          for (const b of event.message?.content ?? []) {
            if (b.type === 'tool_use') calls.push({ name: b.name.replace(/^mcp__paypal__/, ''), args: b.input, ok: true });
          }
        }
        if (event.type === 'user') {
          for (const b of event.message?.content ?? []) {
            if (b.type === 'tool_result' && b.is_error && calls.length) calls[calls.length - 1].ok = false;
          }
        }
        if (event.type === 'result') {
          reply = event.result ?? reply;
          usage = { ...(event.usage ?? {}), cost_usd: event.total_cost_usd };
        }
      }
    }
    const code = await new Promise((r) => child.on('close', r));
    if (code !== 0 && !reply) throw new Error(`claude exited ${code}: ${stderr.slice(0, 300)}`);
    return { reply: reply.trim(), calls, usage };
  }

  return {
    name: `claude-code (${model})`,
    async partnerTurn({ system, text, session, mcpUrl, tools }) {
      return run({ system, prompt: text, session, mcpUrl, allowed: tools.map((t) => t.name) });
    },
    async suspectTurn({ system, text, session }) {
      const { reply } = await run({ system, prompt: text, session });
      return { reply };
    },
  };
}

// npm installs a shell shim on Windows; spawn the real executable behind it.
function findClaude(env) {
  if (process.platform !== 'win32' || !env.APPDATA) return 'claude';
  const exe = join(env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return existsSync(exe) ? exe : 'claude';
}

function scriptedBackend() {
  return {
    name: 'scripted (no model)',
    partnerTurn: ({ text, sheet, refs, callTool }) => scriptedPartner({ text, sheet, refs, callTool }),
    suspectTurn: ({ suspect, text, shown }) => ({ reply: scriptedSuspect({ suspect, text, shown }) }),
  };
}
