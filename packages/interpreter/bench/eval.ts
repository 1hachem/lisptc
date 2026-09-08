import { Interp, prelude, runSync } from "../src/lisp.ts";

const SETUP = `
(defun loop (n acc) (if (= n 0) acc (loop (- n 1) (+ acc n))))
(defun build (n) (if (= n 0) nil (cons n (build (- n 1)))))
(defun sum-with (f n acc) (if (= n 0) acc (sum-with f (- n 1) (+ acc (f n)))))
`;

const CASES: [string, string][] = [
	["tail recursion", "(loop 300000 0)"],
	["dotimes", "(let ((s 0)) (dotimes (i 300000) (setq s (+ s 1))) s)"],
	["closure calls", "(sum-with (lambda (x) (* x 2)) 200000 0)"],
	["string work", '(let ((s "")) (dotimes (i 20000) (setq s (concat "x" s))) (length s))'],
];

function ready(): Interp {
	const interp = new Interp();
	runSync(interp, prelude);
	runSync(interp, SETUP);
	return interp;
}

function time(fn: () => void): number {
	const started = performance.now();
	fn();
	return performance.now() - started;
}

function preludeLoad(): number {
	for (let i = 0; i < 3; i++) runSync(new Interp(), prelude);
	return time(() => {
		for (let i = 0; i < 10; i++) runSync(new Interp(), prelude);
	}) / 10;
}

function maxDepth(): number {
	let lo = 1000;
	let hi = 2000000;
	while (lo < hi - 500) {
		const mid = Math.floor((lo + hi) / 2);
		const interp = ready();
		try {
			runSync(interp, `(length (build ${mid}))`);
			lo = mid;
		} catch {
			hi = mid;
		}
	}
	return lo;
}

for (const [name, code] of CASES) {
	const interp = ready();
	runSync(interp, code);
	console.log(`${name.padEnd(16)} ${time(() => runSync(interp, code)).toFixed(0).padStart(6)} ms`);
}
console.log(`${"prelude load".padEnd(16)} ${preludeLoad().toFixed(1).padStart(6)} ms`);
console.log(`${"max recursion".padEnd(16)} ${String(maxDepth()).padStart(6)} frames`);
