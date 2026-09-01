/** Sanity check for the LaTeX parser + MathJax bridge. Run: npm run check:latex */
import { parseLatex } from '../src/lib/latex/parse';
import { renderMathBatch } from '../src/lib/latex/mathjax.server';

const source = String.raw`
\section{Kinematics}

An object under constant acceleration $a$ satisfies $v = u + at$, and the
displacement follows

$$ s = ut + \tfrac{1}{2} a t^2 $$

\begin{itemize}
\item Velocity is the derivative of displacement.
\item Acceleration is \textbf{constant} here, which is what makes $\int a\,dt$ trivial.
\end{itemize}

The quadratic roots are $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ --- note the 100\% coverage.
`;

const doc = parseLatex(source);

console.log('paragraphs:');
for (const p of doc.paragraphs) {
  const preview = p.nodes
    .map((n) =>
      n.type === 'text' ? n.text : n.type === 'math' ? `[math ${n.tex.slice(0, 24)}]` : '<br>'
    )
    .join('');
  console.log(` ${p.kind}${p.level ? `(${p.level})` : ''}${p.marker ? ` ${p.marker}` : ''}: ${preview.slice(0, 96)}`);
}

console.log('\nwarnings:', doc.warnings);
console.log('formula count:', doc.mathKeys.length);

const { blobs, errors } = renderMathBatch(
  doc.mathKeys.map((key) => ({ key, ...doc.formulas[key] }))
);

console.log('\nblobs:');
for (const [key, blob] of Object.entries(blobs)) {
  console.log(
    ` ${key}: w=${blob.width.toFixed(3)}em asc=${blob.ascent.toFixed(3)} desc=${blob.descent.toFixed(3)} paths=${blob.paths.length}`
  );
}
if (Object.keys(errors).length) console.log('errors:', errors);

const sample = Object.values(blobs).find((b) => b.paths.length > 0);
console.log('\nfirst path data (truncated):', sample?.paths[0].d.slice(0, 140));
