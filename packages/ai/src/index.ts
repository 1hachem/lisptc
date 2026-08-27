// setup an agent loop that connects to a provider which can easily be swapped, the agent needs a system prompt, can have tools (not used intially)
// the provider need to support grammer constrain which allows to send all the model text output to the in memory repl, the agent stream back responses
// this package need to support multi agent orechestration, and needs to stay contained to be run in the background or in the cloud
// intially will try to set it up with langchain andn setup a streaming adapter to for using ai-sdk useChat in the frontend clients
// we can setup a middleware that will send the output of the agent directly into the lisp agent repl

export {
	Agent,
	type AgentConfig,
	type AgentDelta,
	type AgentMessage,
	DEFAULT_SYSTEM_PROMPT,
	type Role,
	streamAgent,
} from "./agent.ts";
export { SYSTEM_PROMPT as LISP_SYSTEM_PROMPT } from "./prompts/lisp.ts";
export {
	fireworks,
	getProvider,
	type ModelOptions,
	type Provider,
	type ProviderName,
	providers,
} from "./provider.ts";
export {
	type ChatInput,
	type ChatMessageInput,
	streamChatResponse,
	toAgentMessages,
} from "./stream.ts";
