// AudioHelper.swift
// Captures system audio via ScreenCaptureKit and writes raw Float32 LE PCM to stdout.
// Format: 48kHz, mono, f32le — pipe through ffmpeg to get a WAV file.
// Exits when stdin closes (parent signals stop by ending the pipe).
// Requires macOS 13+, Screen Recording permission.

import Foundation
import ScreenCaptureKit

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

RunLoop.main.run()
