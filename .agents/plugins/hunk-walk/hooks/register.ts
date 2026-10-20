import type { EngineInterface, Register } from 'claude-code'

const WALK = '.agents/skills/hunk/walk.sh'

export const register: Register = on => {
	on('session.start', async ($, e, next) => {
		await $.command.register({
			name: 'hunk-next',
			description: 'Move the Hunk walkthrough to its next stop',
		})
		await $.command.register({
			name: 'hunk-prev',
			description: 'Move the Hunk walkthrough to its previous stop',
		})
		return next(e)
	})

	on('command.run', { command: 'hunk-next' }, $ => step($, 'next'))
	on('command.run', { command: 'hunk-prev' }, $ => step($, 'prev'))
}

async function step(
	$: EngineInterface,
	move: 'next' | 'prev',
): Promise<{ text: string }> {
	try {
		const { exitCode, stdout, stderr } = await $.process.run([WALK, move])
		return { text: (exitCode === 0 ? stdout : stderr || stdout).trimEnd() }
	} catch (error) {
		return { text: `${WALK} ${move} could not run: ${String(error)}` }
	}
}
