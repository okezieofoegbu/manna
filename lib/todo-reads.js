// lib/todo-reads.js
//
// Owner-only read wrappers for the todos table. Mirrors the shape of
// lib/brief-reads.js (defence in depth: check role here in addition
// to the page-level gate).
//
// The page in app/todo/page.js calls these. Non-owners are redirected
// out before reaching them; these return [] for non-owners as a second
// line of defence.

import { listOpen, listCompletedToday } from './todos.js';

export async function readOpenTodosForOwner(user) {
  if (!user || user.role !== 'owner') return [];
  return listOpen();
}

export async function readCompletedTodayForOwner(user) {
  if (!user || user.role !== 'owner') return [];
  return listCompletedToday();
}
