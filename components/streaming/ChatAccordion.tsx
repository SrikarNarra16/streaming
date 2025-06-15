"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface ChatAccordionProps {
  accordionId: string;
  chatMessages: Array<{ role: "user" | "ai"; message: string }>;
  currentChatInput: string;
  setCurrentChatInput: (value: string) => void;
  onSubmit: (accordionId: string) => void;
  isLoadingResponse: boolean;
  onContinue?: () => void;
  isReadOnly: boolean;
}

export function ChatAccordion({
  accordionId,
  chatMessages,
  currentChatInput,
  setCurrentChatInput,
  onSubmit,
  isLoadingResponse,
  onContinue,
  isReadOnly,
}: ChatAccordionProps) {
  return (
    <div className="mb-4">
      <Accordion
        type="single"
        collapsible
        defaultValue={isReadOnly ? undefined : "chat"}
        className="w-full"
      >
        <AccordionItem
          value="chat"
          className={`border-gray-600 ${
            isReadOnly ? "bg-gray-800 rounded-lg" : ""
          }`}
        >
          <AccordionTrigger className="text-yellow-300 hover:text-yellow-200 px-4">
            {isReadOnly ? "Questions about this section" : "Ask questions about this explanation"}
          </AccordionTrigger>
          <AccordionContent className="space-y-4 px-4">
            {/* Chat messages */}
            <div className="max-h-40 overflow-y-auto space-y-2 bg-gray-900 p-3 rounded">
              {chatMessages.length === 0 ? (
                <div className="text-gray-400 text-sm">
                  {isReadOnly
                    ? "No questions were asked about this section."
                    : "Ask me anything about this explanation..."}
                </div>
              ) : (
                chatMessages.map((msg, index) => (
                  <div
                    key={index}
                    className={`text-sm ${
                      msg.role === "user" ? "text-blue-300" : "text-green-300"
                    }`}
                  >
                    <span className="font-semibold">
                      {msg.role === "user" ? "You:" : "AI:"}
                    </span>{" "}
                    {msg.role === "ai" ? (
                      <div className="inline">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <span>{children}</span>,
                            code: ({ children }) => (
                              <code className="bg-gray-700 px-1 rounded text-yellow-300">
                                {children}
                              </code>
                            ),
                            pre: ({ children }) => (
                              <pre className="bg-gray-700 p-2 rounded mt-1 overflow-x-auto">
                                {children}
                              </pre>
                            ),
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside mt-1">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-inside mt-1">
                                {children}
                              </ol>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-bold text-white">
                                {children}
                              </strong>
                            ),
                            em: ({ children }) => (
                              <em className="italic text-gray-200">
                                {children}
                              </em>
                            ),
                          }}
                        >
                          {msg.message}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      msg.message
                    )}
                  </div>
                ))
              )}
              {isLoadingResponse && (
                <div className="text-gray-400 text-sm italic">
                  AI is thinking...
                </div>
              )}
            </div>

            {/* Chat input or read-only message */}
            {isReadOnly ? (
              <div className="text-gray-500 text-sm italic">
                This conversation is now read-only.
              </div>
            ) : (
              <>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={currentChatInput}
                    onChange={(e) => setCurrentChatInput(e.target.value)}
                    onKeyPress={(e) =>
                      e.key === "Enter" &&
                      !isLoadingResponse &&
                      onSubmit(accordionId)
                    }
                    disabled={isLoadingResponse}
                    className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    placeholder={
                      isLoadingResponse
                        ? "AI is responding..."
                        : "Type your question..."
                    }
                  />
                  <button
                    onClick={() => onSubmit(accordionId)}
                    disabled={isLoadingResponse || !currentChatInput.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>

                {/* Continue button */}
                {onContinue && (
                  <div className="flex justify-end">
                    <button
                      onClick={onContinue}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded transition-colors"
                    >
                      Continue with explanation
                    </button>
                  </div>
                )}
              </>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}