// Any CLI that reads a prompt on stdin and prints the answer on stdout. Useful for local models
// and agent CLIs. Example: CF_LLM_COMMAND="ollama run llama3.2"
// Check your tool's docs for its non-interactive / stdin mode.
import { env } from '../../lib/env.mjs';
import { runCmd } from '../../lib/ffmpeg.mjs';
import { fillCommand } from '../../lib/util.mjs';

export default {
  name: 'command',
  paid: false, // depends on what the command calls
  canned: false,
  async complete({ system = '', prompt }) {
    const tpl = env('CF_LLM_COMMAND');
    if (!tpl) throw new Error('set CF_LLM_COMMAND (see .env.example)');
    const [cmd, ...args] = fillCommand(tpl, {});
    const input = system ? `${system}\n\n${prompt}` : prompt;
    const { stdout } = await runCmd(cmd, args, { input, timeoutMs: 10 * 60 * 1000 });
    return stdout.trim();
  },
};
