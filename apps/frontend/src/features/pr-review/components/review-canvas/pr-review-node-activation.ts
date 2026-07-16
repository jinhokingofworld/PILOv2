import type { Editor } from "tldraw";

type PrReviewFileNodeActivationHandler = {
  onOpen: (reviewFileId: string) => void;
};

const activationHandlers = new WeakMap<
  Editor,
  PrReviewFileNodeActivationHandler
>();

export function registerPrReviewFileNodeActivationHandler(
  editor: Editor,
  handler: PrReviewFileNodeActivationHandler
) {
  activationHandlers.set(editor, handler);

  return () => {
    if (activationHandlers.get(editor) === handler) {
      activationHandlers.delete(editor);
    }
  };
}

export function activatePrReviewFileNode(
  editor: Editor,
  reviewFileId: string
) {
  activationHandlers.get(editor)?.onOpen(reviewFileId);
}
