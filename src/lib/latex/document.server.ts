/** Compile a complete LaTeX document with the locally installed TeX engine. */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_SOURCE_BYTES = 1_000_000;
const TIMEOUT_MS = 45_000;
const LOG_LIMIT = 12_000;

export class LatexCompileError extends Error {}

export async function compileLatexDocument(source: string): Promise<Uint8Array> {
  if (!source.includes('\\documentclass') || !source.includes('\\begin{document}')) {
    throw new LatexCompileError('A full LaTeX document must include \\documentclass and \\begin{document}.');
  }
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new LatexCompileError('LaTeX source is limited to 1 MB.');
  }

  const workdir = await mkdtemp(join(tmpdir(), 'nb-make-latex-'));
  const input = join(workdir, 'document.tex');
  const output = join(workdir, 'document.pdf');

  try {
    await writeFile(input, source, 'utf8');
    const log = await runCompiler(input, workdir);
    try {
      return await readFile(output);
    } catch {
      throw new LatexCompileError(`The compiler did not create a PDF.\n${log}`);
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function runCompiler(input: string, workdir: string): Promise<string> {
  try {
    return await runProcess(
      'latexmk',
      ['-pdf', '-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', `-outdir=${workdir}`, input],
      workdir
    );
  } catch (error) {
    // MiKTeX's latexmk is a Perl script. Its Windows installer can provide the
    // wrapper without Perl itself, so use the underlying engine in that case.
    if (!(error instanceof LatexCompileError) || !/latexmk was not found|script engine 'perl'/i.test(error.message)) {
      throw error;
    }
    const first = await runProcess(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', `-output-directory=${workdir}`, input],
      workdir
    );
    const second = await runProcess(
      'pdflatex',
      ['-interaction=nonstopmode', '-halt-on-error', '-no-shell-escape', `-output-directory=${workdir}`, input],
      workdir
    );
    return `${first}\n${second}`;
  }
}

function runProcess(command: string, args: string[], workdir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workdir,
      shell: false,
      windowsHide: true,
      env: { ...process.env, openin_any: 'p', openout_any: 'p' },
    });

    let log = '';
    const append = (chunk: Buffer) => {
      if (log.length < LOG_LIMIT) log += chunk.toString('utf8').slice(0, LOG_LIMIT - log.length);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    const timer = setTimeout(() => {
      child.kill();
      reject(new LatexCompileError(`Compilation timed out after ${TIMEOUT_MS / 1000} seconds.`));
    }, TIMEOUT_MS);

    child.once('error', (error) => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new LatexCompileError(`${command} was not found. Install MiKTeX or TeX Live and ensure its binaries are on PATH.`));
      } else {
        reject(new LatexCompileError(`Could not start ${command}: ${error.message}`));
      }
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(log);
      else reject(new LatexCompileError(compactLog(log) || `LaTeX compilation failed (exit code ${code ?? 'unknown'}).`));
    });
  });
}

function compactLog(log: string): string {
  const relevant = log
    .split(/\r?\n/)
    .filter((line) => /! |^l\.\d+|LaTeX (?:Error|Warning)|Emergency stop|Fatal error/i.test(line));
  return (relevant.length ? relevant : log.split(/\r?\n/).slice(-30)).join('\n').trim();
}
