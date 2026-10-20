import { expect, test } from 'claude-code/testing'

test('each command runs one walk.sh move and shows what it printed', async ($, on) => {
	const ran: string[][] = []
	on('process.run', async (_, e) => {
		ran.push([...e.argv])
		return { value: { exitCode: 0, stdout: `Stop at ${e.argv[1]}\n`, stderr: '' } }
	})

	expect(await $.command.run({ command: 'hunk-next' })).toMatchObject({ text: 'Stop at next' })
	expect(await $.command.run({ command: 'hunk-prev' })).toMatchObject({ text: 'Stop at prev' })
	expect(await $.command.run({ command: 'hunk-go', args: ' 3 ' })).toMatchObject({ text: 'Stop at go' })
	expect(ran).toEqual([
		['.agents/skills/hunk/walk.sh', 'next'],
		['.agents/skills/hunk/walk.sh', 'prev'],
		['.agents/skills/hunk/walk.sh', 'go', '3'],
	])
})

test('a refused move shows the reason walk.sh gave', async ($, on) => {
	on('process.run', async () => ({ value: { exitCode: 1, stdout: '', stderr: 'No stop 13: the walk has 12.\n' } }))

	expect(await $.command.run({ command: 'hunk-next' })).toMatchObject({
		text: 'No stop 13: the walk has 12.',
	})
})

test('/hunk-go without a stop number shows its usage and runs nothing', async ($, on) => {
	const ran: string[][] = []
	on('process.run', async (_, e) => {
		ran.push([...e.argv])
		return { value: { exitCode: 0, stdout: '', stderr: '' } }
	})

	for (const args of ['', 'two', '0', '-1']) {
		expect(await $.command.run({ command: 'hunk-go', args })).toMatchObject({
			text: 'Usage: /hunk-go <stop>, a stop number from 1.',
		})
	}
	expect(ran).toEqual([])
})
