"use client";

import React from "react";
import { ChatAccordion } from "./ChatAccordion";

interface ParagraphFeedbackProps {
  currentAccordionId: string | null;
  onFeedback: (understood: boolean) => void;
  feedbackMessage: string;
  onChatSubmit: (accordionId: string) => void;
  currentChatInput: string;
  setCurrentChatInput: (value: string) => void;
  isLoadingResponse: boolean;
  onContinueAfterChat: () => void;
  chatMessages: Array<{ role: "user" | "ai"; message: string }>;
}

export function ParagraphFeedback({
  currentAccordionId,
  onFeedback,
  feedbackMessage,
  onChatSubmit,
  currentChatInput,
  setCurrentChatInput,
  isLoadingResponse,
  onContinueAfterChat,
  chatMessages,
}: ParagraphFeedbackProps) {
  return (
    <span className="block mt-4 p-4 bg-gray-800 rounded-lg border border-gray-600">
      <div className="text-blue-300 mb-3">Am I making sense?</div>

      {/* Only show buttons if no current accordion is active */}
      {!currentAccordionId && (
        <div className="flex items-center space-x-4 mb-4">
          <button
            onClick={() => onFeedback(true)}
            className="flex items-center px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
          >
            <span className="text-xl mr-2">👍</span>
            <span>Yes, continue</span>
          </button>
          <button
            onClick={() => onFeedback(false)}
            className="flex items-center px-4 py-2 bg-yellow-600 hover:bg-yellow-700 rounded-lg transition-colors"
          >
            <span className="text-xl mr-2">❓</span>
            <span>I don't understand</span>
          </button>
        </div>
      )}

      {/* Current Chat Accordion */}
      {currentAccordionId && (
        <ChatAccordion
          accordionId={currentAccordionId}
          chatMessages={chatMessages}
          currentChatInput={currentChatInput}
          setCurrentChatInput={setCurrentChatInput}
          onSubmit={onChatSubmit}
          isLoadingResponse={isLoadingResponse}
          onContinue={onContinueAfterChat} // Add this prop
        />
      )}

      {feedbackMessage && (
        <div className="mt-3 text-yellow-300 font-medium">
          {feedbackMessage}
        </div>
      )}
    </span>
  );
}
