import { describe, expect, it } from "vitest";
import { ev, freshInterp, roundTrip } from "./helpers.ts";

describe("numeric basics", () => {
	it("predicates", () => {
		expect(
			ev(
				"(list (zerop 0) (zerop 0.0) (plusp 1) (minusp -1) (evenp 4) (oddp 4))",
			),
		).toBe("(t t t t t nil)");
		expect(() => ev("(evenp 1.5)")).toThrow(/not an integer/);
	});

	it("abs, min, max and the steppers keep exactness", () => {
		expect(
			ev(
				"(list (abs -3) (abs -2.5) (min 3 1 2) (max 1 4.0 2) (1+ 1) (1- 1.5))",
			),
		).toBe("(3 2.5 1 4.0 2 0.5)");
	});

	it("floor, ceiling and round give exact integers", () => {
		expect(
			ev("(list (floor 7 2) (floor -7 2) (ceiling 7 2) (ceiling -7 2))"),
		).toBe("(3 -4 4 -3)");
		expect(
			ev("(list (round 5 2) (round 7 2) (round 2.5) (round 3.5) (round -2.5))"),
		).toBe("(2 4 2 4 -2)");
		expect(ev("(list (floor 2.7) (ceiling -2.7))")).toBe("(2 -2)");
		expect(() => ev("(floor (/ 1 0))")).toThrow(/not a finite number/);
	});

	it("expt, sqrt, gcd, lcm and parse-integer", () => {
		expect(ev("(expt 2 100)")).toBe("1267650600228229401496703205376");
		expect(ev("(list (expt 2 -1) (expt 2.0 3) (sqrt 16))")).toBe(
			"(0.5 8.0 4.0)",
		);
		expect(ev("(list (gcd 12 18 24) (gcd) (lcm 4 6) (lcm))")).toBe(
			"(6 0 12 1)",
		);
		expect(ev('(parse-integer " -42 ")')).toBe("-42");
		expect(() => ev('(parse-integer "4x")')).toThrow(/not an integer/);
	});
});

describe("list basics", () => {
	it("reverse and copy-list leave the original alone", () => {
		expect(
			ev("(let ((xs '(1 2 3))) (list (reverse xs) xs (copy-list xs)))"),
		).toBe("((3 2 1) (1 2 3) (1 2 3))");
	});

	it("search and count", () => {
		expect(
			ev(
				"(list (find 2 '(1 2 3)) (find 9 '(1 2)) (find-if stringp '(1 \"a\")))",
			),
		).toBe('(2 nil "a")');
		expect(
			ev('(list (position "b" \'("a" "b")) (position-if numberp \'(a 1)))'),
		).toBe("(1 1)");
		expect(ev("(list (count 1 '(1 2 1)) (count-if numberp '(a 1 2)))")).toBe(
			"(2 2)",
		);
	});

	it("some and every", () => {
		expect(ev("(some (lambda (x) (and (< 1 x) (* x 10))) '(1 2 3))")).toBe(
			"20",
		);
		expect(
			ev(
				"(list (every numberp '(1 2)) (every numberp '(1 a)) (every numberp nil))",
			),
		).toBe("(t nil t)");
	});

	it("remove, remove-if and remove-duplicates", () => {
		expect(ev("(remove 2 '(1 2 3 2))")).toBe("(1 3)");
		expect(ev("(remove-if numberp '(a 1 b))")).toBe("(a b)");
		expect(ev('(remove-duplicates \'(1 2 1 "a" 3 "a" 2))')).toBe('(1 2 "a" 3)');
	});

	it("nthcdr, butlast, subseq and elt", () => {
		expect(
			ev(
				"(list (nthcdr 2 '(1 2 3)) (butlast '(1 2 3)) (butlast '(1 2 3) 2) (butlast '(1) 5))",
			),
		).toBe("((3) (1 2) (1) nil)");
		expect(
			ev(
				'(list (subseq \'(1 2 3 4) 1 3) (subseq "hello" 1) (elt \'(1 2) 1) (elt "ab" 0))',
			),
		).toBe('((2 3) "ello" 2 "a")');
		expect(() => ev("(elt '(1 2) 5)")).toThrow(/index out of range/);
	});

	it("mapc returns its list", () => {
		expect(
			ev("(let ((n 0)) (list (mapc (lambda (x) (setq n (+ n x))) '(1 2)) n))"),
		).toBe("((1 2) 3)");
	});

	it("sort is stable and copies", () => {
		expect(ev("(let ((xs '(5 3 9 1 3 7))) (list (sort xs <) xs))")).toBe(
			"((1 3 3 5 7 9) (5 3 9 1 3 7))",
		);
		expect(ev('(sort \'("pear" "apple" "fig") string<)')).toBe(
			'("apple" "fig" "pear")',
		);
		expect(
			ev(
				"(sort '((b . 1) (a . 1) (c . 0)) (lambda (x y) (< (cdr x) (cdr y))))",
			),
		).toBe("((c . 0) (b . 1) (a . 1))");
	});
});

describe("places", () => {
	it("setf, push, pop, incf and decf on variables and list places", () => {
		expect(
			ev(
				"(let ((xs (list 1 2 3)) (n 0)) (push 0 xs) (incf n 5) (decf n) (setf (nth 1 xs) :x) (list (pop xs) xs n))",
			),
		).toBe("(0 (:x 2 3) 4)");
		expect(ev("(let ((c (cons 1 2))) (setf (car c) :a (cdr c) :b) c)")).toBe(
			"(:a . :b)",
		);
	});

	it("setf through get-in rebinds the record", () => {
		expect(
			ev('(let ((r (list (cons "a" 1)))) (setf (get-in r "a") 5) r)'),
		).toBe('(("a" . 5))');
	});

	it("refuses what is not a place", () => {
		expect(() => ev("(setf (length x) 1)")).toThrow(/not a place/);
	});
});

describe("hash tables", () => {
	it("store by equal keys", () => {
		expect(
			ev(`(let ((h (make-hash-table)))
			      (puthash "a" 1 h)
			      (puthash 2 :two h)
			      (setf (gethash (list 1 2) h) "pair")
			      (list (gethash "a" h) (gethash 2.0 h) (gethash (list 1 2) h)
			            (gethash "z" h :none) (hash-table-count h) (hash-table-keys h)))`),
		).toBe('(1 :two "pair" :none 3 ("a" 2 (1 2)))');
	});

	it("remhash, clrhash and hash-has-key", () => {
		expect(
			ev(`(let ((h (make-hash-table)))
			      (puthash :k nil h)
			      (list (hash-has-key :k h) (gethash :k h :d) (remhash :k h) (remhash :k h)
			            (hash-table-count (clrhash h)) (hash-table-p h)))`),
		).toBe("(t nil t nil 0 t)");
	});

	it("list values and entries in insertion order", () => {
		expect(
			ev(`(let ((h (make-hash-table)))
			      (puthash :b 2 h)
			      (puthash :a 1 h)
			      (puthash :b 3 h)
			      (list (hash-table-values h) (hash-table-alist h)))`),
		).toBe("((3 1) ((:b . 3) (:a . 1)))");
	});

	it("print as an unreadable printout", () => {
		expect(ev("(make-hash-table)")).toBe("#<hash-table 0>");
	});

	it("survive an image round trip", () => {
		const interp = freshInterp();
		ev(
			'(setq h (make-hash-table)) (puthash "a" (list 1 2) h) (puthash 3 :x h)',
			interp,
		);
		expect(
			ev(
				'(list (gethash "a" h) (gethash 3 h) (hash-table-count h))',
				roundTrip(interp),
			),
		).toBe("((1 2) :x 2)");
	});
});

describe("vectors", () => {
	it("aset stores in place and returns the value", () => {
		expect(ev("(let ((v (make-vector 3 0))) (list (aset v 1 :x) v))")).toBe(
			"(:x #<vector 0 :x 0>)",
		);
		expect(() => ev("(aset (vector) 0 1)")).toThrow(/index out of range/);
	});

	it("index, set, grow and convert", () => {
		expect(
			ev(
				"(let ((v (vector 1 2 3))) (setf (aref v 0) 10) (vector-push 4 v) (list v (length v) (elt v 3) (subseq v 1 3) (vector-to-list v)))",
			),
		).toBe("(#<vector 10 2 3 4> 4 4 #<vector 2 3> (10 2 3 4))");
		expect(
			ev("(list (make-vector 2 0) (list-to-vector '(a b)) (vectorp (vector)))"),
		).toBe("(#<vector 0 0> #<vector a b> t)");
		expect(() => ev("(aref (vector 1) 1)")).toThrow(/index out of range/);
	});

	it("survive an image round trip", () => {
		const interp = freshInterp();
		ev('(setq v (vector 1 "two" (list 3)))', interp);
		expect(ev("v", roundTrip(interp))).toBe('#<vector 1 "two" (3)>');
	});
});

describe("characters as one-character strings", () => {
	it("codes and classes", () => {
		expect(
			ev(
				'(list (char-code "A") (code-char 97) (digit-char-p "7") (digit-char-p "x") (alpha-char-p "é") (whitespace-char-p " "))',
			),
		).toBe('(65 "a" 7 nil t t)');
	});
});

describe("string basics", () => {
	it("ordering, case-insensitive equality, padding and fixed digits", () => {
		expect(
			ev(
				'(list (string< "a" "b") (string> "a" "b") (string-equal "Ab" "aB") (string-pad-left "7" 3 "0") (string-pad-right "ab" 4) (number-to-string 3.14159 2))',
			),
		).toBe('(t nil t "007" "ab  " "3.14")');
	});
});

describe("non-local exits", () => {
	it("return-from leaves the named block through loops and calls", () => {
		expect(
			ev(
				"(block outer (dolist (x '(1 2 3)) (when (= x 2) (return-from outer (* x 10)))) :never)",
			),
		).toBe("20");
		expect(ev("(block a (block b (return-from a 1)) 2)")).toBe("1");
		expect(ev("(block a 7)")).toBe("7");
	});

	it("throw unwinds to the matching catch", () => {
		expect(
			ev(
				'(catch :done (mapcar (lambda (x) (if (= x 2) (throw :done "early") x)) \'(1 2 3)))',
			),
		).toBe('"early"');
		expect(ev("(catch :x (catch :y (throw :x 1)) 2)")).toBe("1");
	});

	it("a throw or return-from with nothing to reach is a catchable error", () => {
		expect(() => ev("(throw :nope 1)")).toThrow(/no catch for tag/);
		expect(() => ev("(catch :x 1) (throw :x 2)")).toThrow(/no catch for tag/);
		expect(() => ev("(return-from nowhere 1)")).toThrow(/no enclosing block/);
		expect(ev('(try (throw :nope 1) (catch (e) "caught"))')).toBe('"caught"');
	});

	it("try still catches errors inside a catch form", () => {
		expect(
			ev("(defun f (x) (try (catch :t (throw :t x)) (catch (e) e))) (f 9)"),
		).toBe("9");
	});

	it("unwind-protect runs its cleanup however the form exits", () => {
		expect(
			ev(
				'(let ((log nil)) (try (unwind-protect (error "boom") (setq log "cleaned")) (catch (e) (list e log))))',
			),
		).toBe('("boom" "cleaned")');
		expect(
			ev("(let ((n 0)) (catch :x (unwind-protect (throw :x 1) (setq n 5))) n)"),
		).toBe("5");
		expect(
			ev(
				"(let ((n 0)) (dotimes (i 3) (unwind-protect (break) (setq n (+ n 1)))) n)",
			),
		).toBe("1");
		expect(ev("(unwind-protect 1 2)")).toBe("1");
	});
});
