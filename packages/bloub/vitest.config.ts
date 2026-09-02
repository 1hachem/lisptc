import { defineConfig } from "vitest/config";

/*
 * Environnement `node`, sans DOM et sans plugin de rendu : le moteur (`src/bot/`)
 * est une fonction pure du temps, ses tests n'ont donc rien a monter. C'est ce
 * qui garde la suite a quelques secondes. Un test qui aurait besoin d'un DOM le
 * demande en tete de fichier (`// @vitest-environment happy-dom`), fichier par
 * fichier — un environnement global ralentirait tout le reste pour lui seul.
 */
export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.{ts,tsx}"],
	},
});
