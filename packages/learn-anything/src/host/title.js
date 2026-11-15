/**
 * Name the Session after the course goal once the tutor saves it, over dsh-session-title.
 * Without the sessionTitle service nothing here is mounted.
 * @module learn-anything/title
 */

/**
 * Rename `session` to `goal` unless its title was set by hand. `rename()` records a
 * `user`-sourced title, so this happens at most once per Session: a later course_save
 * (or the learner's own rename) leaves the title alone.
 * @param titles - the dsh-session-title service (`get`, `rename`)
 * @returns whether the Session was renamed
 */
export function titleAfterGoal(titles, session, goal) {
  if (typeof goal !== 'string' || !goal.trim()) return false
  if (titles.get(session)?.source.kind === 'user') return false
  titles.rename(session, goal)
  return true
}
