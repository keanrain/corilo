# Corilo interaction overview

[简体中文](DESIGN.md) | **English**

2026-11-15. This describes current entry points and interaction boundaries. Original layouts remain in the [v0.34 interaction proposal (Chinese)](history/v0.34/DESIGN.md); rules are in the [specification](PRODUCT-SPEC.en.md).

## Notes workspace

Open the Files.md notes panel within DSH. Retain the file tree, editing, search, renaming, moving, archiving, split panes, capture, journals, and checklists. Save before switching to Agent; returning retains the iframe editor state. Save conflicts preserve input without silently overwriting external changes.

## Tasks and calendars

New instances enable todos planner. Task views include Inbox, Today, Future, All, Completed, and Cancelled, with separate Calendar and Reminders views. Search, filters, and pagination are supported. Today distinguishes overdue, today, and previously planned items.

Creation and details support dates, deadlines, priorities, and lists. Date deadlines and exact instants use distinct inputs. Details commit through explicit Save. Unknown request outcomes are checked through receipts rather than immediately resubmitted.

Calendar views include month, week, day, and agenda, supporting independent events, all-day events, and task time blocks. Dragging or resizing first restores the current display and opens a pending form; confirmation commits the change. Forms provide equivalent operations. Valid start changes preserve duration; end times are exclusive.

Reminders retain an in-app history. Browser notifications require explicit authorization; closing the page disables delivery. Do not describe a notification claim as guaranteed receipt.

## Learning tutor

After installation, users select the learning tutor preset in an existing DSH workspace. The plugin does not force directory navigation or change default presets. Route, target-map, progress, and feedback cards appear with responses. Planning routes and target maps support direct editing through host authentication and revision checks; personal notes do not grant verification credit. Interactive exercises and flashcards use the native right learning pane. See the [tutor guide](../packages/learn-anything/README.en.md).

## Compatibility and acceptance

Existing notes classic and todos v1 retain their own interfaces without automatic conversion. Unimplemented note-source links, recurrence, and external notifications must not appear as usable features.

Record browser coverage separately for Files.md, planner, legacy compatibility pages, and the tutor. Narrow-screen Chromium tests are not physical-phone acceptance. See the [handoff log (Chinese)](HANDOFF.md) for executed checks.
