"""Read the pinned editor state: CodeMirror virtualizes long document DOM.

This test-only adapter follows EditorView.findFromDOM's DOM association.
All edits use ordinary Playwright fill/keyboard/pointer interactions.
"""
import time


def editor_value(locator):
    return locator.evaluate("(el) => el.cmTile.root.view.state.doc.toString()")


def expect_editor_value(locator, value, timeout=5000):
    expected = value.replace('\r\n', '\n').replace('\r', '\n')
    deadline = time.monotonic() + timeout / 1000
    actual = None
    while time.monotonic() < deadline:
        actual = editor_value(locator)
        if actual == expected:
            return
        locator.page.wait_for_timeout(50)
    assert actual == expected, f"Editor value differs: {actual[:300]!r} != {expected[:300]!r}"
