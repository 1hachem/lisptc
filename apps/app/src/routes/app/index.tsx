import { createFileRoute } from "@tanstack/react-router";
import { AppLoading } from "../../components/app-loading.tsx";

export const Route = createFileRoute("/app/")({
	component: AppLoading,
});
