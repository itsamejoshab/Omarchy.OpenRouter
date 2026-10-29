pragma Singleton

import QtQuick
import Quickshell.Io
import "../Model.js" as Model

// One price fetch, one timer, and one history file for every monitor.
// Bar widgets read `view`. They do not fetch. A request that arrives while
// one is in flight is ignored, so one IPC refresh is one fetch.
Item {
  id: root

  property bool shown: false
  property bool fetching: false
  property bool ready: false
  property bool startRequested: false
  property int generation: 0
  property var state: null
  property var view: Model.decide(null, null, 0, "pending")

  readonly property string helperPath: String(Qt.resolvedUrl("../prices.sh")).replace(/^file:\/\//, "")

  Component.onCompleted: root.load()

  function load() {
    if (root.helperPath === "") {
      root.ready = true
      return
    }
    loadProc.command = ["bash", root.helperPath, "load"]
    loadProc.running = true
  }

  function apply(next, persist) {
    root.state = next.state
    root.view = next
    if (persist && root.shown) root.persist(next.state)
  }

  function setShown(on) {
    var next = on === true
    if (next === root.shown) return
    root.shown = next
    if (!next) {
      // The in-flight result is discarded. History already on disk stays,
      // and nothing is written while the switch is off.
      root.generation += 1
      root.fetching = false
      root.startRequested = false
      hour.stop()
      retry.stop()
      return
    }
    root.request()
  }

  // Manual refreshes and the startup fetch. A duplicate during a fetch is ignored.
  function request() {
    if (!root.shown || root.helperPath === "") return
    if (!root.ready) {
      root.startRequested = true
      return
    }
    root.armHour()
    if (root.fetching || fetchProc.running) return
    // Timer ids are component ids, not properties of root.
    retry.stop()
    root.generation += 1
    root.fetching = true
    fetchProc.pendingGen = root.generation
    fetchProc.command = ["bash", root.helperPath]
    fetchProc.running = true
  }

  function armHour() {
    retry.stop()
    hour.restart()
  }

  function armRetry() {
    hour.stop()
    retry.restart()
  }

  function finishFetch(gen, text, failed) {
    root.fetching = false
    if (!root.shown || gen !== root.generation) {
      if (root.shown) root.request()
      return
    }
    var parsed = null
    if (!failed) {
      try {
        parsed = JSON.parse(String(text || ""))
      } catch (e) {
        parsed = null
      }
    }
    var outcome = "error"
    var payload = null
    if (parsed && parsed.ok === true && Array.isArray(parsed.models)) {
      outcome = "ok"
      payload = parsed.models
    }
    var next = Model.decide(payload, root.state, Date.now(), outcome)
    root.apply(next, true)
    if (outcome === "ok") root.armHour()
    else root.armRetry()
  }

  function finishLoad(text) {
    var parsed = null
    try {
      parsed = JSON.parse(String(text || ""))
    } catch (e) {
      parsed = null
    }
    var loaded = null
    if (parsed && parsed.ok === true && parsed.state && typeof parsed.state === "object" && !Array.isArray(parsed.state))
      loaded = parsed.state
    var next = Model.decide(null, loaded, Date.now(), "pending")
    root.ready = true
    // Prune is in the returned state. Only write it while prices are on.
    root.apply(next, root.shown)
    if (root.shown) {
      root.startRequested = false
      root.request()
    }
  }

  function persist(document) {
    if (!root.shown || root.helperPath === "") return
    saveProc.payload = JSON.stringify(document)
    if (saveProc.running) {
      saveProc.dirty = true
      return
    }
    saveProc.command = ["bash", root.helperPath, "save"]
    saveProc.running = true
  }

  // Success waits about an hour. Failure retries in about a minute, then a
  // success returns to the hour. The vertical bar does not stop either one.
  Timer {
    id: hour
    interval: 60 * 60 * 1000
    repeat: false
    onTriggered: root.request()
  }

  Timer {
    id: retry
    interval: 60 * 1000
    repeat: false
    onTriggered: root.request()
  }

  Process {
    id: loadProc
    running: false
    command: []
    stdout: StdioCollector { id: loadOut; waitForEnd: true }
    onExited: root.finishLoad(loadOut.text)
  }

  Process {
    id: fetchProc
    property int pendingGen: 0
    running: false
    command: []
    stdout: StdioCollector { id: fetchOut; waitForEnd: true }
    stderr: StdioCollector { id: fetchErr; waitForEnd: true }
    onExited: function(exitCode) {
      root.finishFetch(pendingGen, fetchOut.text, exitCode !== 0)
    }
  }

  Process {
    id: saveProc
    property string payload: ""
    property bool dirty: false
    running: false
    command: []
    stdinEnabled: true
    onStarted: write(payload + "\n")
    onExited: {
      if (!dirty || !root.shown) {
        dirty = false
        return
      }
      dirty = false
      command = ["bash", root.helperPath, "save"]
      running = true
    }
  }
}
