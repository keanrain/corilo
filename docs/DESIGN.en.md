# Corilo interaction overview

[简体中文](DESIGN.md) | **English**

2026-11-15. This describes current entry points and interaction boundaries. Original layouts remain in the [v0.34 interaction proposal (Chinese)](history/v0.34/DESIGN.md); rules are in the [specification](PRODUCT-SPEC.en.md).

## Notes workspace

Open the Files.md notes panel within DSH. It is for reading and editing notes: retain the file tree, editing, search, renaming, moving, archiving, split panes, journals, and checklists, with no capture page and no Agent button. The workspace opens the last note read, else the most recently changed note, and offers to create one when the library is empty. Colours match the task planner: a warm grey sidebar, a white page and a single blue accent. Files.md interface text follows the host language while note names and contents are never translated. New notes select their placeholder title so typing names them. Save before switching to another host panel; returning retains the iframe editor state. Save conflicts preserve input without silently overwriting external changes.

## Tasks and calendars

New instances enable todos planner. A left sidebar lists Today, Future, Inbox and All with open-task counts, Calendar, Reminders, every named list with its count, and Done and Cancelled; on narrow screens it becomes a drawer. Each task view starts with an inline field: type a title and press Enter to add. Search, filters, and pagination are supported. Today distinguishes overdue, today, and previously planned items, and lists the day's events and task time blocks above them. Tasks added from Today, Future or a list filter are prefilled with that date or list. The display zone applies the device zone at once, is remembered per browser, and is changed explicitly in the time-zone popover.

Creation and details support dates, deadlines, priorities, and lists. Date deadlines and exact instants use distinct inputs. Exact deadlines, reminders and timed event bounds use date + time controls in the record's zone; daylight-saving gaps and overlaps list candidates with explicit offsets for the person to choose. Reminders offer shortcuts and flag times that have passed. Details commit through explicit Save. Unknown request outcomes are checked through receipts rather than immediately resubmitted.

Calendar views include month, week, day, and agenda, supporting independent events, all-day events, and task time blocks. Dragging or resizing first restores the current display and opens a pending form; confirmation commits the change. Forms provide equivalent operations. Valid start changes preserve duration; end times are exclusive.

Reminders retain an in-app history. Browser notifications require explicit authorization; closing the page disables delivery. Do not describe a notification claim as guaranteed receipt.

Planner uses compact top navigation, grouped task rows, collapsible filters, and a consistent calendar. Wide screens place details beside the list; narrow layouts have scrollable view navigation and a full-width editor. Theme and language follow the host. Native controls retain visible keyboard focus, and errors or unknown results appear beside the detail fields.

Conflict previews show all editable task/event fields and cleared values, and remain accessible while editing. Review the entire form before keeping local input; adopting the server version clears the conflict. Save and receipt checks release the controls after the list refresh finishes or times out. New input is preserved.

## Learning tutor

After installation, users select the learning tutor preset in an existing DSH workspace. The plugin does not force directory navigation or change default presets. Route, target-map, progress, and feedback cards appear with responses. Planning routes and target maps support direct editing through host authentication and revision checks; personal notes do not grant verification credit. Interactive exercises and flashcards use the native right learning pane. See the [tutor guide](../packages/learn-anything/README.en.md).

## Compatibility and acceptance

Existing notes classic and todos v1 retain their own interfaces without automatic conversion. Unimplemented note-source links, recurrence, and external notifications must not appear as usable features.

Record browser coverage separately for Files.md, planner, legacy compatibility pages, and the tutor. Narrow-screen Chromium tests are not physical-phone acceptance. See the [handoff log (Chinese)](HANDOFF.md) for executed checks.
