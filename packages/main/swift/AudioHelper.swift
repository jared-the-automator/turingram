// AudioHelper.swift
// Two modes, both ending when stdin closes (the parent signals stop by ending the pipe).
//
// Default: captures system audio via ScreenCaptureKit and writes raw Float32 LE PCM
// to stdout. Format: 48kHz, mono, f32le — pipe through ffmpeg to get a WAV file.
// Requires macOS 13+, Screen Recording permission.
//
// --watch-mic: meeting detection. Prints one JSON line each time the set of
// processes doing audio input or output changes:
//   {"procs":[{"pid":123,"bundle":"us.zoom.xos","name":"zoom.us","in":true,"out":true}]}
// Reads CoreAudio's per-process objects, which need macOS 14.2 and no
// permission. Older systems get {"unsupported":true} and an exit.

import Foundation
import ScreenCaptureKit
import CoreAudio
import Darwin

class AudioCapture: NSObject, SCStreamDelegate, SCStreamOutput {
  let stdout = FileHandle.standardOutput

  func stream(_ stream: SCStream, didOutputSampleBuffer buf: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio,
          let blockBuf = CMSampleBufferGetDataBuffer(buf) else { return }
    var ptr: UnsafeMutablePointer<Int8>?
    var len = 0
    guard CMBlockBufferGetDataPointer(
      blockBuf, atOffset: 0,
      lengthAtOffsetOut: nil, totalLengthOut: &len,
      dataPointerOut: &ptr
    ) == noErr, let ptr else { return }
    stdout.write(Data(bytes: ptr, count: len))
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    fputs("stream stopped: \(error.localizedDescription)\n", stderr)
  }
}

func startCapture() {
  let capture = AudioCapture()

  Task {
    do {
      let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
      guard let display = content.displays.first else {
        fputs("error: no display found\n", stderr)
        exit(1)
      }

      let config = SCStreamConfiguration()
      config.capturesAudio = true
      config.excludesCurrentProcessAudio = false
      config.sampleRate = 48000
      config.channelCount = 1
      // Minimal display region — required by SCStream even when only capturing audio
      config.width = 2
      config.height = 2

      let filter = SCContentFilter(
        display: display,
        excludingApplications: [],
        exceptingWindows: []
      )
      let stream = SCStream(filter: filter, configuration: config, delegate: capture)
      try stream.addStreamOutput(capture, type: .audio, sampleHandlerQueue: .global())
      try await stream.startCapture()
      fputs("ready\n", stderr)

      // Block until stdin EOF — parent closes stdin to signal stop
      await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
        DispatchQueue.global().async {
          _ = FileHandle.standardInput.readDataToEndOfFile()
          cont.resume()
        }
      }

      try await stream.stopCapture()
      exit(0)
    } catch {
      fputs("error: \(error.localizedDescription)\n", stderr)
      exit(1)
    }
  }
}

// MARK: --watch-mic

func exitWhenStdinCloses() {
  DispatchQueue.global().async {
    _ = FileHandle.standardInput.readDataToEndOfFile()
    exit(0)
  }
}

func globalAddress(_ selector: AudioObjectPropertySelector) -> AudioObjectPropertyAddress {
  AudioObjectPropertyAddress(
    mSelector: selector,
    mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain
  )
}

func readUInt32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
  var address = globalAddress(selector)
  var value: UInt32 = 0
  var size = UInt32(MemoryLayout<UInt32>.size)
  return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
}

@available(macOS 14.2, *)
func readPID(_ object: AudioObjectID) -> pid_t? {
  var address = globalAddress(kAudioProcessPropertyPID)
  var value: pid_t = 0
  var size = UInt32(MemoryLayout<pid_t>.size)
  return AudioObjectGetPropertyData(object, &address, 0, nil, &size, &value) == noErr ? value : nil
}

@available(macOS 14.2, *)
func readBundleID(_ object: AudioObjectID) -> String {
  var address = globalAddress(kAudioProcessPropertyBundleID)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  let status = withUnsafeMutablePointer(to: &value) {
    AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
  }
  guard status == noErr, let string = value?.takeRetainedValue() else { return "" }
  return string as String
}

func processName(_ pid: pid_t) -> String {
  var buffer = [CChar](repeating: 0, count: 4096)
  guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return "" }
  return (String(cString: buffer) as NSString).lastPathComponent
}

@available(macOS 14.2, *)
func audioProcesses() -> [[String: Any]] {
  let system = AudioObjectID(kAudioObjectSystemObject)
  var address = globalAddress(kAudioHardwarePropertyProcessObjectList)
  var size: UInt32 = 0
  guard AudioObjectGetPropertyDataSize(system, &address, 0, nil, &size) == noErr, size > 0 else { return [] }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  guard AudioObjectGetPropertyData(system, &address, 0, nil, &size, &ids) == noErr else { return [] }

  var rows: [[String: Any]] = []
  for id in ids {
    let input = (readUInt32(id, kAudioProcessPropertyIsRunningInput) ?? 0) != 0
    let output = (readUInt32(id, kAudioProcessPropertyIsRunningOutput) ?? 0) != 0
    guard input || output, let pid = readPID(id) else { continue }
    rows.append([
      "pid": Int(pid),
      "bundle": readBundleID(id),
      "name": processName(pid),
      "in": input,
      "out": output,
    ])
  }
  return rows.sorted { ($0["pid"] as? Int ?? 0) < ($1["pid"] as? Int ?? 0) }
}

func printLine(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
        let line = String(data: data, encoding: .utf8) else { return }
  print(line)
  fflush(stdout)
}

func watchMic() {
  guard #available(macOS 14.2, *) else {
    printLine(["unsupported": true])
    exit(0)
  }
  exitWhenStdinCloses()
  // Polled, not listened: CoreAudio fires process listeners in bursts that
  // mostly report no change. Two seconds is well inside the parent's debounce.
  var last = ""
  let tick = {
    let rows = audioProcesses()
    guard let data = try? JSONSerialization.data(withJSONObject: ["procs": rows], options: [.sortedKeys]),
          let line = String(data: data, encoding: .utf8), line != last else { return }
    last = line
    print(line)
    fflush(stdout)
  }
  tick()
  Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in tick() }
}

if CommandLine.arguments.contains("--watch-mic") {
  watchMic()
} else {
  startCapture()
}

RunLoop.main.run()
