import { describe, expect, test } from "vitest";

import { mapVideoErrorToFriendlyMessage } from "./video-error-messages";

describe("mapVideoErrorToFriendlyMessage", () => {
  test("maps empty video error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Uploaded video is empty.",
      "en",
    );
    expect(result).toBe("The uploaded file is empty.");
  });

  test("maps too large error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Uploaded video exceeds the owner-locked byte limit (20 MiB).",
      "en",
    );
    expect(result).toBe("The video file is too large. Maximum file size is 20 MB.");
  });

  test("maps too long duration error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Video duration (30.5s) exceeds the owner-locked limit (25s).",
      "en",
    );
    expect(result).toBe("The video is too long. Maximum duration is 25 seconds.");
  });

  test("maps resolution error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Video resolution (3840x2160) exceeds the owner-locked limits (1920x1080).",
      "en",
    );
    expect(result).toBe("The video resolution is too high. Maximum resolution is 1920x1080.");
  });

  test("maps unsupported container error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      'Video container format "avi" is not allowed. Allowed: mp4, mov.',
      "en",
    );
    expect(result).toBe("This file isn't a supported video. Upload an MP4 or MOV video.");
  });

  test("maps unsupported codec error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      'Video codec "vp9" is not allowed. Allowed: h264, h265.',
      "en",
    );
    expect(result).toBe("This video uses an unsupported codec. Upload an MP4 video with H.264 or H.265 encoding.");
  });

  test("maps content type mismatch error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Uploaded bytes do not match the declared content type.",
      "en",
    );
    expect(result).toBe("This file isn't a supported video. Upload an MP4 video.");
  });

  test("maps only MP4 error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Only MP4 video uploads are supported.",
      "en",
    );
    expect(result).toBe("This file isn't a supported video. Upload an MP4 video.");
  });

  test("maps probe error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Failed to probe video metadata: ffprobe exited with code 1",
      "en",
    );
    expect(result).toBe("Unable to read the video file. The file may be corrupted.");
  });

  test("maps transcode error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Failed to transcode video: ffmpeg timed out",
      "en",
    );
    expect(result).toBe("Unable to process the video. Please try again or contact support.");
  });

  test("maps poster extraction error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Failed to extract poster frame: ffmpeg returned empty output",
      "en",
    );
    expect(result).toBe("Unable to generate video thumbnail. Please try again.");
  });

  test("maps quarantined error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Quarantined after 3 attempts: Failed to transcode video",
      "en",
    );
    expect(result).toBe("The video could not be processed after multiple attempts.");
  });

  test("maps unknown error to generic message", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Some unexpected error occurred",
      "en",
    );
    expect(result).toBe("An error occurred while processing the video. Please try again.");
  });

  test("maps null error to generic message", () => {
    const result = mapVideoErrorToFriendlyMessage(null, "en");
    expect(result).toBe("An error occurred while processing the video. Please try again.");
  });

  test("returns Arabic translation for empty video error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Uploaded video is empty.",
      "ar",
    );
    expect(result).toBe("الملف المرفوع فارغ.");
  });

  test("returns Arabic translation for too large error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      "Uploaded video exceeds the owner-locked byte limit (20 MiB).",
      "ar",
    );
    expect(result).toBe("حجم الفيديو كبير جدًا. الحد الأقصى 20 ميغابايت.");
  });

  test("returns Arabic translation for unsupported codec error", () => {
    const result = mapVideoErrorToFriendlyMessage(
      'Video codec "vp9" is not allowed.',
      "ar",
    );
    expect(result).toBe("يستخدم هذا الفيديو ترميزًا غير مدعوم. ارفع فيديو MP4 بترميز H.264 أو H.265.");
  });
});
