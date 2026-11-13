import { Component, createRef, type ErrorInfo, type ReactNode } from "react";

export class ErrorWithJSX extends Error {
	jsx: ReactNode;

	constructor(message: string, jsx: ReactNode) {
		super(message);
		this.name = "ErrorWithJSX";
		this.jsx = jsx;
	}
}

export class ErrorBoundary extends Component<
	{
		fallback?: (error: Error, errorInfo: ErrorInfo) => ReactNode;
		children: ReactNode;
		resetOnChange?: any;
	},
	{
		hasError: boolean;
		error: Error | null;
		errorInfo: ErrorInfo | null;
		copied: boolean;
	}
> {
	state: {
		hasError: boolean;
		error: Error | null;
		errorInfo: ErrorInfo | null;
		copied: boolean;
	} = {
		hasError: false,
		error: null,
		errorInfo: null,
		copied: false,
	};

	jsxRef = createRef<HTMLDivElement>();
	copiedTimeout: ReturnType<typeof setTimeout> | null = null;

	errorAsText(): string {
		const { error, errorInfo } = this.state;
		if (!error) return "";
		const parts: string[] = [`Error: ${error.message}`];
		const jsxText = this.jsxRef.current?.innerText.trim();
		if (jsxText) parts.push(jsxText);
		if (error.stack) parts.push(`Stack trace:\n${error.stack}`);
		if (errorInfo?.componentStack) {
			parts.push(`Component stack:${errorInfo.componentStack}`);
		}
		return parts.join("\n\n");
	}

	copy = async () => {
		const text = this.errorAsText();
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const ta = document.createElement("textarea");
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand("copy");
			ta.remove();
		}
		this.setState({ copied: true });
		if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
		this.copiedTimeout = setTimeout(
			() => this.setState({ copied: false }),
			1500,
		);
	};

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error, errorInfo: null };
	}

	componentDidCatch(error: Error, errorInfo: ErrorInfo) {
		console.error(error, errorInfo);
		this.setState({ error, errorInfo });
	}

	componentDidUpdate(prevProps: { resetOnChange?: any }) {
		if (
			this.state.hasError &&
			this.props.resetOnChange !== prevProps.resetOnChange
		) {
			this.reset();
		}
	}

	reset = () => {
		this.setState({
			hasError: false,
			error: null,
			errorInfo: null,
			copied: false,
		});
	};

	render() {
		if (this.state.hasError && this.state.error) {
			if (this.props.fallback) {
				return this.props.fallback(this.state.error, this.state.errorInfo!);
			}

			const error = this.state.error;
			const isErrorWithJSX = error instanceof ErrorWithJSX;

			return (
				<div
					style={{
						border: "1px solid rgb(252, 165, 165)",
						background: "rgb(254, 242, 242)",
						borderRadius: 6,
						padding: 16,
						margin: 16,
						userSelect: "text",
						alignSelf: "flex-start",
						minWidth: 0,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "flex-start",
							justifyContent: "space-between",
							gap: 12,
							marginBottom: 8,
						}}
					>
						<div
							style={{
								fontWeight: 600,
								color: "rgb(153, 27, 27)",
								fontSize: "1.125rem",
							}}
						>
							Error: {error.message}
						</div>
						<div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
							<button
								onClick={this.copy}
								title="Copy the whole error as plain text"
								style={{
									padding: "4px 12px",
									background: "white",
									color: "rgb(153, 27, 27)",
									borderRadius: 6,
									fontSize: "0.875rem",
									fontWeight: 500,
									border: "1px solid rgb(252, 165, 165)",
									cursor: "pointer",
									minWidth: 72,
								}}
							>
								{this.state.copied ? "Copied!" : "Copy"}
							</button>
							<button
								onClick={this.reset}
								style={{
									padding: "4px 12px",
									background: "rgb(220, 38, 38)",
									color: "white",
									borderRadius: 6,
									fontSize: "0.875rem",
									fontWeight: 500,
									border: "none",
									cursor: "pointer",
								}}
							>
								Reset
							</button>
						</div>
					</div>

					{isErrorWithJSX && (
						<div ref={this.jsxRef} style={{ marginTop: 12, marginBottom: 12 }}>
							{(error as ErrorWithJSX).jsx}
						</div>
					)}

					{error.stack && (
						<details style={{ marginTop: 12 }}>
							<summary
								style={{
									cursor: "pointer",
									color: "rgb(185, 28, 28)",
									fontWeight: 500,
									marginBottom: 4,
								}}
							>
								Stack Trace
							</summary>
							<pre
								style={{
									fontSize: "0.75rem",
									background: "rgb(254, 226, 226)",
									padding: 12,
									borderRadius: 6,
									overflowX: "auto",
									color: "rgb(127, 29, 29)",
									marginTop: 8,
								}}
							>
								{error.stack}
							</pre>
						</details>
					)}

					{this.state.errorInfo?.componentStack && (
						<details style={{ marginTop: 12 }}>
							<summary
								style={{
									cursor: "pointer",
									color: "rgb(185, 28, 28)",
									fontWeight: 500,
									marginBottom: 4,
								}}
							>
								Component Stack
							</summary>
							<pre
								style={{
									fontSize: "0.75rem",
									background: "rgb(254, 226, 226)",
									padding: 12,
									borderRadius: 6,
									overflowX: "auto",
									color: "rgb(127, 29, 29)",
									marginTop: 8,
								}}
							>
								{this.state.errorInfo.componentStack}
							</pre>
						</details>
					)}
				</div>
			);
		}

		return this.props.children;
	}
}
