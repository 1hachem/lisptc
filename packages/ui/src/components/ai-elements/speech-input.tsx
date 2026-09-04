"use client";

import type { ComponentProps } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";

interface SpeechRecognition extends EventTarget {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	start(): void;
	stop(): void;
	onstart: ((this: SpeechRecognition, ev: Event) => void) | null;
	onend: ((this: SpeechRecognition, ev: Event) => void) | null;
	onresult:
		| ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void)
		| null;
	onerror:
		| ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
		| null;
}

interface SpeechRecognitionEvent extends Event {
	results: SpeechRecognitionResultList;
	resultIndex: number;
}

interface SpeechRecognitionResultList {
	readonly length: number;
	item(index: number): SpeechRecognitionResult;
	[index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
	readonly length: number;
	item(index: number): SpeechRecognitionAlternative;
	[index: number]: SpeechRecognitionAlternative;
	isFinal: boolean;
}

interface SpeechRecognitionAlternative {
	transcript: string;
	confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
	error: string;
}

declare global {
	interface Window {
		SpeechRecognition: new () => SpeechRecognition;
		webkitSpeechRecognition: new () => SpeechRecognition;
	}
}

type SpeechInputMode = "speech-recognition" | "media-recorder" | "none";

// `onError` shadows the button's DOM error handler, which we have no use for.
export type SpeechInputProps = Omit<
	ComponentProps<typeof Button>,
	"onError"
> & {
	onTranscriptionChange?: (text: string) => void;
	/**
	 * Callback for when audio is recorded using MediaRecorder fallback.
	 * This is called in browsers that don't support the Web Speech API (Firefox, Safari).
	 * The callback receives an audio Blob that should be sent to a transcription service.
	 * Return the transcribed text, which will be passed to onTranscriptionChange.
	 */
	onAudioRecorded?: (audioBlob: Blob) => Promise<string>;
	/** human-readable failure report (permission refused, no mic, network, …) */
	onError?: (message: string) => void;
	lang?: string;
};

const recognitionErrorMessages: Record<string, string> = {
	"not-allowed": "microphone access was denied by the browser",
	"service-not-allowed": "microphone access was denied by the browser",
	"audio-capture": "no microphone found",
	"no-speech": "no speech was detected — try again",
	network: "the speech service could not be reached",
	aborted: "speech recognition was interrupted",
};

const getSpeechRecognition = (): SpeechRecognition | null => {
	if (typeof window === "undefined") {
		return null;
	}
	const Ctor =
		window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
	return Ctor ? new Ctor() : null;
};

const detectSpeechInputMode = (): SpeechInputMode => {
	if (typeof window === "undefined") {
		return "none";
	}

	if ("SpeechRecognition" in window || "webkitSpeechRecognition" in window) {
		return "speech-recognition";
	}

	if ("MediaRecorder" in window && "mediaDevices" in navigator) {
		return "media-recorder";
	}

	return "none";
};

const micError = (error: unknown): string => {
	if (error instanceof DOMException) {
		if (error.name === "NotAllowedError" || error.name === "SecurityError") {
			return "microphone access was denied by the browser";
		}
		if (
			error.name === "NotFoundError" ||
			error.name === "OverconstrainedError"
		) {
			return "no microphone found";
		}
		return error.message || "the microphone could not be started";
	}
	return error instanceof Error && error.message
		? error.message
		: "the microphone could not be started";
};

export const SpeechInput = ({
	className,
	onTranscriptionChange,
	onAudioRecorded,
	onError,
	lang,
	disabled,
	...props
}: SpeechInputProps) => {
	const [isListening, setIsListening] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [mode] = useState<SpeechInputMode>(detectSpeechInputMode);
	const [isRecognitionReady, setIsRecognitionReady] = useState(false);
	const recognitionRef = useRef<SpeechRecognition | null>(null);
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const audioChunksRef = useRef<Blob[]>([]);
	const onTranscriptionChangeRef = useRef<
		SpeechInputProps["onTranscriptionChange"]
	>(onTranscriptionChange);
	const onAudioRecordedRef =
		useRef<SpeechInputProps["onAudioRecorded"]>(onAudioRecorded);
	const onErrorRef = useRef<SpeechInputProps["onError"]>(onError);

	onTranscriptionChangeRef.current = onTranscriptionChange;
	onAudioRecordedRef.current = onAudioRecorded;
	onErrorRef.current = onError;

	useEffect(() => {
		if (mode !== "speech-recognition") {
			return;
		}

		const speechRecognition = getSpeechRecognition();
		if (!speechRecognition) {
			return;
		}

		speechRecognition.continuous = true;
		speechRecognition.interimResults = true;
		speechRecognition.lang =
			lang ?? (typeof navigator !== "undefined" ? navigator.language : "en-US");

		const handleStart = () => {
			setIsListening(true);
		};

		const handleEnd = () => {
			setIsListening(false);
		};

		const handleResult = (event: Event) => {
			const speechEvent = event as SpeechRecognitionEvent;
			let finalTranscript = "";

			for (
				let i = speechEvent.resultIndex;
				i < speechEvent.results.length;
				i += 1
			) {
				const result = speechEvent.results[i];
				if (result.isFinal) {
					finalTranscript += result[0]?.transcript ?? "";
				}
			}

			if (finalTranscript) {
				onTranscriptionChangeRef.current?.(finalTranscript);
			}
		};

		const handleError = (event: Event) => {
			const { error } = event as SpeechRecognitionErrorEvent;
			setIsListening(false);
			onErrorRef.current?.(
				recognitionErrorMessages[error] ?? "speech recognition failed",
			);
		};

		speechRecognition.addEventListener("start", handleStart);
		speechRecognition.addEventListener("end", handleEnd);
		speechRecognition.addEventListener("result", handleResult);
		speechRecognition.addEventListener("error", handleError);

		recognitionRef.current = speechRecognition;
		setIsRecognitionReady(true);

		return () => {
			speechRecognition.removeEventListener("start", handleStart);
			speechRecognition.removeEventListener("end", handleEnd);
			speechRecognition.removeEventListener("result", handleResult);
			speechRecognition.removeEventListener("error", handleError);
			speechRecognition.stop();
			recognitionRef.current = null;
			setIsRecognitionReady(false);
		};
	}, [mode, lang]);

	useEffect(
		() => () => {
			if (mediaRecorderRef.current?.state === "recording") {
				mediaRecorderRef.current.stop();
			}
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) {
					track.stop();
				}
			}
		},
		[],
	);

	const startMediaRecorder = useCallback(async () => {
		if (!onAudioRecordedRef.current) {
			return;
		}

		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			streamRef.current = stream;
			const mediaRecorder = new MediaRecorder(stream);
			audioChunksRef.current = [];

			const handleDataAvailable = (event: BlobEvent) => {
				if (event.data.size > 0) {
					audioChunksRef.current.push(event.data);
				}
			};

			const handleStop = async () => {
				for (const track of stream.getTracks()) {
					track.stop();
				}
				streamRef.current = null;

				const audioBlob = new Blob(audioChunksRef.current, {
					type: "audio/webm",
				});

				if (audioBlob.size > 0 && onAudioRecordedRef.current) {
					setIsProcessing(true);
					try {
						const transcript = await onAudioRecordedRef.current(audioBlob);
						if (transcript) {
							onTranscriptionChangeRef.current?.(transcript);
						}
					} catch {
						// Error handling delegated to the onAudioRecorded caller
					} finally {
						setIsProcessing(false);
					}
				}
			};

			const handleError = () => {
				setIsListening(false);
				for (const track of stream.getTracks()) {
					track.stop();
				}
				streamRef.current = null;
			};

			mediaRecorder.addEventListener("dataavailable", handleDataAvailable);
			mediaRecorder.addEventListener("stop", handleStop);
			mediaRecorder.addEventListener("error", handleError);

			mediaRecorderRef.current = mediaRecorder;
			mediaRecorder.start();
			setIsListening(true);
		} catch (error) {
			setIsListening(false);
			onErrorRef.current?.(micError(error));
		}
	}, []);

	const stopMediaRecorder = useCallback(() => {
		if (mediaRecorderRef.current?.state === "recording") {
			mediaRecorderRef.current.stop();
		}
		setIsListening(false);
	}, []);

	const stopListening = useCallback(() => {
		if (mode === "speech-recognition") {
			recognitionRef.current?.stop();
		} else if (mode === "media-recorder") {
			stopMediaRecorder();
		}
	}, [mode, stopMediaRecorder]);

	const toggleListening = useCallback(() => {
		if (isListening) {
			stopListening();
			return;
		}
		if (mode === "speech-recognition" && recognitionRef.current) {
			try {
				recognitionRef.current.start();
			} catch {
				// `start()` throws if the engine is still winding down from the last
				// session; the button is simply a no-op until `end` fires.
			}
		} else if (mode === "media-recorder") {
			startMediaRecorder();
		}
	}, [mode, isListening, startMediaRecorder, stopListening]);

	// A host that locks its composer must not be left with a live mic behind it:
	// the transcript would have nowhere to land.
	useEffect(() => {
		if (disabled && isListening) {
			stopListening();
		}
	}, [disabled, isListening, stopListening]);

	const isDisabled =
		disabled ||
		mode === "none" ||
		(mode === "speech-recognition" && !isRecognitionReady) ||
		(mode === "media-recorder" && !onAudioRecorded) ||
		isProcessing;

	return (
		<Button
			type="button"
			variant="ghost"
			aria-label={isListening ? "stop dictating" : "dictate a message"}
			title={
				mode === "none" || (mode === "media-recorder" && !onAudioRecorded)
					? "this browser cannot transcribe speech"
					: undefined
			}
			{...props}
			className={cn(
				"h-auto gap-[7px] rounded-none bg-bg2 px-[9px] py-px font-mono text-[11.5px] transition-none hover:bg-bg2 hover:brightness-125",
				isListening ? "text-red" : "text-fg",
				className,
			)}
			disabled={isDisabled}
			onClick={toggleListening}
		>
			<span>{isProcessing ? "transcribing" : "mic"}</span>
			<span className={cn("text-dim", isListening && "animate-pulse text-red")}>
				{isProcessing ? "…" : isListening ? "●" : "◉"}
			</span>
		</Button>
	);
};
