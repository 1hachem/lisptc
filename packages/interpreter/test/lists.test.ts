import { describe, expect, it } from "vitest";
import { ev } from "./helpers.ts";

describe("core list accessors", () => {
	it("car / cdr, guarded on nil", () => {
		expect(ev("(car '(1 2 3))")).toBe("1");
		expect(ev("(cdr '(1 2 3))")).toBe("(2 3)");
		expect(ev("(car nil)")).toBe("nil");
		expect(ev("(cdr nil)")).toBe("nil");
	});

	it("cons / list / length", () => {
		expect(ev("(cons 1 '(2 3))")).toBe("(1 2 3)");
		expect(ev("(list 1 2 3)")).toBe("(1 2 3)");
		expect(ev("(list)")).toBe("nil");
		expect(ev("(length '(1 2 3))")).toBe("3");
		expect(ev("(length nil)")).toBe("0");
		expect(ev('(length "hello")')).toBe("5");
	});

	it("compound accessors from the prelude", () => {
		expect(ev("(cadr '(1 2 3))")).toBe("2");
		expect(ev("(caddr '(1 2 3))")).toBe("3");
		expect(ev("(cddr '(1 2 3))")).toBe("(3)");
	});
});

describe("append / mapcar / membership / assoc", () => {
	it("append is non-destructive and variadic", () => {
		expect(ev("(append '(1 2) '(3 4))")).toBe("(1 2 3 4)");
		expect(ev("(append '(1) '(2) '(3))")).toBe("(1 2 3)");
		expect(ev("(append nil '(1))")).toBe("(1)");
		expect(ev("(append '(1) nil)")).toBe("(1)");
	});

	it("mapcar maps a function over a list", () => {
		expect(ev("(mapcar (lambda (x) (* x x)) '(1 2 3))")).toBe("(1 4 9)");
		expect(ev("(mapcar car '((1 a) (2 b)))")).toBe("(1 2)");
	});

	it("nth indexes a list from 0", () => {
		expect(ev("(nth 0 '(a b c))")).toBe("a");
		expect(ev("(nth 2 '(a b c))")).toBe("c");
		expect(ev("(nth 3 '(a b c))")).toBe("nil");
		expect(ev("(nth 0 nil)")).toBe("nil");
		expect(ev("(nth -1 '(a b c))")).toBe("nil");
	});

	it("nth walks a long list without overflowing the stack", () => {
		expect(
			ev("(setq l nil) (dotimes (i 20000) (setq l (cons i l))) (nth 19999 l)"),
		).toBe("0");
	});

	it("member / memq", () => {
		expect(ev("(member 3 '(1 2 3 4))")).toBe("(3 4)");
		expect(ev("(member 9 '(1 2 3))")).toBe("nil");
		expect(ev("(memq 'b '(a b c))")).toBe("(b c)");
	});

	it("assoc / assq", () => {
		expect(ev("(assoc 'b '((a 1) (b 2)))")).toBe("(b 2)");
		expect(ev("(assq 'x '((a 1)))")).toBe("nil");
	});

	it("last", () => {
		expect(ev("(last '(1 2 3))")).toBe("(3)");
	});
});

describe("equality predicates on structures", () => {
	it("equal is deep, eq/eql are shallow", () => {
		expect(ev("(equal '(1 (2 3)) '(1 (2 3)))")).toBe("t");
		expect(ev("(equal '(1 2) '(1 2 3))")).toBe("nil");
		expect(ev("(eq '(1 2) '(1 2))")).toBe("nil");
		expect(ev('(equal "abc" "abc")')).toBe("t");
	});
});

describe("destructive operations", () => {
	it("rplaca / rplacd mutate cells in place", () => {
		expect(ev("(setq l (list 1 2 3)) (rplaca l 9) (progn l)")).toBe("(9 2 3)");
		expect(ev("(setq l (list 1 2 3)) (rplacd l '(8)) (progn l)")).toBe("(1 8)");
	});

	it("nreverse reverses in place", () => {
		expect(ev("(nreverse (list 1 2 3))")).toBe("(3 2 1)");
	});

	it("nconc concatenates in place", () => {
		expect(ev("(setq a (list 1 2)) (setq b (list 3 4)) (nconc a b) a")).toBe(
			"(1 2 3 4)",
		);
	});
});

describe("filter / reduce", () => {
	it("filter keeps the elements the predicate says yes to", () => {
		expect(ev("(filter (lambda (n) (< 2 n)) '(1 2 3 4))")).toBe("(3 4)");
		expect(ev("(filter consp '(1 (2) 3))")).toBe("((2))");
		expect(ev("(filter identity nil)")).toBe("nil");
	});

	it("reduce folds left, with or without an initial value", () => {
		expect(ev("(reduce + '(1 2 3))")).toBe("6");
		expect(ev("(reduce + '(1 2 3) 10)")).toBe("16");
		expect(ev('(reduce (lambda (a s) (concat a s)) \'("a" "b") "")')).toBe(
			'"ab"',
		);
		expect(ev("(reduce + '(7))")).toBe("7");
		expect(ev("(reduce + nil)")).toBe("nil");
		expect(ev("(reduce + nil 5)")).toBe("5");
	});

	it("reduce names the argument order when the list is not one", () => {
		expect(ev("(try (reduce + 0 '(1 2)) (catch (e) e))")).toContain(
			"the list comes second",
		);
	});
});

describe("get-in", () => {
	const config = `(setq c '(("server" . (("port" . 8080)
	                                       ("hosts" . ("a.example" "b.example"))))))`;

	it("reads through nested alists and lists", () => {
		expect(ev(`${config} (get-in c "server" "port")`)).toBe("8080");
		expect(ev(`${config} (get-in c "server" "hosts" 1)`)).toBe('"b.example"');
		expect(ev(`${config} (get-in c "server")`)).toBe(
			'(("port" . 8080) ("hosts" "a.example" "b.example"))',
		);
	});

	it("gives nil for a missing step instead of erroring", () => {
		expect(ev(`${config} (get-in c "server" "tls" "cert")`)).toBe("nil");
		expect(ev(`${config} (get-in c "client" "port")`)).toBe("nil");
		expect(ev(`${config} (get-in c "server" "port" "deeper")`)).toBe("nil");
		expect(ev('(get-in nil "a")')).toBe("nil");
	});

	it("matches a string key with a keyword or symbol of the same name", () => {
		expect(ev(`${config} (get-in c :server :port)`)).toBe("8080");
		expect(ev(`${config} (get-in c 'server 'port)`)).toBe("8080");
	});

	it("reads through keyword plists, matching any key by name", () => {
		const page = `(setq p '(:theme (:accent "red") :sections ((:type :hero))))`;
		expect(ev(`${page} (get-in p :theme :accent)`)).toBe('"red"');
		expect(ev(`${page} (get-in p "theme" 'accent)`)).toBe('"red"');
		expect(ev(`${page} (get-in p :sections 0 :type)`)).toBe(":hero");
		expect(ev(`${page} (get-in p :theme :font)`)).toBe("nil");
	});
});

describe("set-in", () => {
	const page = `(setq p '(:theme (:accent "red") :sections ((:type :hero) (:type :faq))))`;

	it("replaces a value at a plist path and leaves the record untouched", () => {
		expect(ev(`${page} (set-in p "blue" :theme :accent)`)).toBe(
			'(:theme (:accent "blue") :sections ((:type :hero) (:type :faq)))',
		);
		expect(ev(`${page} (set-in p "blue" :theme :accent) p`)).toBe(
			'(:theme (:accent "red") :sections ((:type :hero) (:type :faq)))',
		);
	});

	it("adds a missing keyword key and builds a missing record", () => {
		expect(ev(`${page} (get-in (set-in p "geist" :theme :font) :theme)`)).toBe(
			'(:accent "red" :font "geist")',
		);
		expect(ev("(set-in nil 1 :a :b)")).toBe("(:a (:b 1))");
		expect(ev('(set-in nil 1 "a")')).toBe('(("a" . 1))');
	});

	it("writes through a list index, appending at the length", () => {
		expect(
			ev(`${page} (get-in (set-in p :cta :sections 1 :type) :sections)`),
		).toBe("((:type :hero) (:type :cta))");
		expect(ev("(set-in '(a b) 'c 2)")).toBe("(a b c)");
		expect(ev("(try (set-in '(a b) 'c 5) (catch (e) e))")).toContain(
			"past the end",
		);
	});

	it("writes through alists the way get-in reads them", () => {
		const config = `(setq c '(("server" . (("port" . 8080)))))`;
		expect(ev(`${config} (set-in c 9090 :server :port)`)).toBe(
			'(("server" ("port" . 9090)))',
		);
		expect(ev(`${config} (set-in c "x" "server" "host")`)).toBe(
			'(("server" ("port" . 8080) ("host" . "x")))',
		);
	});

	it("refuses to descend into a value that is not a record", () => {
		expect(ev("(try (set-in '(:a 1) 2 :a :b) (catch (e) e))")).toContain(
			"not a record",
		);
		expect(ev('(try (set-in \'(:a 1) 2 "b") (catch (e) e))')).toContain(
			"must be a keyword",
		);
	});
});

describe("update-in", () => {
	it("applies a function to the value at the path", () => {
		expect(ev("(update-in '(:n 1) (lambda (n) (+ n 1)) :n)")).toBe("(:n 2)");
		expect(
			ev(
				"(update-in '(:s ((:t :a))) (lambda (s) (append s (list '(:t :b)))) :s)",
			),
		).toBe("(:s ((:t :a) (:t :b)))");
	});

	it("hands the function nil for a missing path", () => {
		expect(ev("(update-in '(:a 1) (lambda (x) (if x x 0)) :b)")).toBe(
			"(:a 1 :b 0)",
		);
	});
});

describe("remove-in", () => {
	const page = `(setq p '(:theme (:accent "red" :font "geist") :sections ((:type :hero) (:type :faq))))`;

	it("drops a plist key, a list element and an alist pair", () => {
		expect(ev(`${page} (get-in (remove-in p :theme :font) :theme)`)).toBe(
			'(:accent "red")',
		);
		expect(ev(`${page} (get-in (remove-in p :sections 0) :sections)`)).toBe(
			"((:type :faq))",
		);
		expect(ev(`(remove-in '(("a" . 1) ("b" . 2)) :a)`)).toBe('(("b" . 2))');
	});

	it("gives the record back for a missing path and never changes it", () => {
		expect(ev(`${page} (equal (remove-in p :nope :deeper) p)`)).toBe("t");
		expect(
			ev(`${page} (remove-in p :sections 0) (length (get-in p :sections))`),
		).toBe("2");
	});
});

describe("keywordp", () => {
	it("is true only for keywords", () => {
		expect(ev("(keywordp :a)")).toBe("t");
		expect(ev("(keywordp 'a)")).toBe("nil");
		expect(ev('(keywordp ":a")')).toBe("nil");
	});
});

describe("apply", () => {
	it("applies functions to argument lists", () => {
		expect(ev("(apply + '(1 2 3))")).toBe("6");
		expect(ev("(apply cons '(1 2))")).toBe("(1 . 2)");
		expect(ev("(apply list '(1 2 3))")).toBe("(1 2 3)");
	});
});

describe("the path forms on exactly read JSON", () => {
	it("set-in fills an empty object and an empty array", () => {
		expect(ev('(set-in :{} 1 "a")')).toBe('(("a" . 1))');
		expect(ev("(set-in :{} 1 :a)")).toBe("(:a 1)");
		expect(ev('(set-in :[] "x" 0)')).toBe('(:[] "x")');
	});

	it("an index skips the :[] tag of an array", () => {
		const grid = `(setq g '(:[] ("a" 1) ("b" 2)))`;
		expect(ev(`${grid} (get-in g 1 0)`)).toBe('"b"');
		expect(ev(`${grid} (set-in g 9 0 1)`)).toBe('(:[] ("a" 9) ("b" 2))');
		expect(ev(`${grid} (remove-in g 0)`)).toBe('(:[] ("b" 2))');
	});

	it("a tagged array is never read as a plist", () => {
		expect(ev(`(get-in '(:[] 5 6) :[])`)).toBe("nil");
	});
});
