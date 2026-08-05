const TASK_REVIEW_REQUEST_EVENT = "pi-studio:task-review-request";

export function requestTaskReview(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TASK_REVIEW_REQUEST_EVENT));
}

export function subscribeTaskReview(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(TASK_REVIEW_REQUEST_EVENT, listener);
  return () => window.removeEventListener(TASK_REVIEW_REQUEST_EVENT, listener);
}
