import { argv, stdout } from 'node:process'

export const createBoard = (tasks = []) => ({
  tasks: tasks.map(task => ({ ...task }))
})

export const addTask = (board, task) => {
  if (task.title == null || task.title.trim() === '') {
    throw new Error('Task title is required.')
  }

  const nextTask = {
    id: task.id ?? `task-${board.tasks.length + 1}`,
    title: task.title.trim(),
    priority: task.priority ?? 'medium',
    done: task.done ?? false
  }

  return {
    tasks: [...board.tasks, nextTask]
  }
}

export const completeTask = (board, taskId) => ({
  tasks: board.tasks.map(task => (
    task.id === taskId ? { ...task, done: true } : task
  ))
})

export const summarizeBoard = (board) => {
  const total = board.tasks.length
  const done = board.tasks.filter(task => task.done).length

  return {
    total,
    done,
    open: total - done
  }
}

if (import.meta.url === `file://${argv[1]}`) {
  const board = completeTask(
    addTask(
      addTask(createBoard(), { title: 'Write demo script', priority: 'high' }),
      { title: 'Capture screenshot', priority: 'medium' }
    ),
    'task-1'
  )

  stdout.write(`${JSON.stringify({ board, summary: summarizeBoard(board) }, null, 2)}\n`)
}
