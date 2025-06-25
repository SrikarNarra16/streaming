"use client";

import React from "react";

interface BlankInputProps {
  userInput: string;
  setUserInput: (value: string) => void;
  onSubmit: () => void;
  currentBlankAnswer: string;
  feedbackMessage: string;
}

export function BlankInput({
  userInput,
  setUserInput,
  onSubmit,
  currentBlankAnswer,
  feedbackMessage,
}: BlankInputProps) {
  return (
  <div className="blank-question-box bg-gray-900 border border-gray-700 rounded-md p-3 flex items-center mb-4">
  <span className="mr-2 text-gray-400 text-lg">❓</span>
  <div className="flex-1">
    <div className="text-gray-300 text-sm mb-1">Fill in the blank</div>
    <div className="flex items-center">
      <input
        type="text"
        value={userInput}
        onChange={(e) => setUserInput(e.target.value)}
        onKeyPress={(e) => e.key === "Enter" && onSubmit()}
        className="mx-1 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[80px]"
        placeholder="Enter your answer"
        autoFocus
      />
      <button
        onClick={onSubmit}
        className="ml-2 px-3 py-1 bg-gray-700 text-gray-200 rounded text-sm hover:bg-gray-600"
      >
        Go
      </button>
      {feedbackMessage && (
        <span
          className={`ml-4 font-medium ${
            feedbackMessage.includes("Correct")
              ? "text-green-400"
              : "text-red-400"
          }`}
        >
          {feedbackMessage}
        </span>
      )}
    </div>
  </div>
</div>
);
}
