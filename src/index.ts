export type { CaptureOptions } from "./capture";
export type {
  Attachment,
  AttachmentLimits,
  FeedbackReport,
  Mark,
  Screenshot,
} from "./shared/report";
export type {
  FeedbackEvent,
  FeedbackEvents,
  FeedbackOptions,
  FeedbackStrings,
  FeedbackWidget,
} from "./widget";
export { createFeedback, discardDraft } from "./widget";
