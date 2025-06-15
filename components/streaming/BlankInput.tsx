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
    <span className="inline-block ml-1">
      <input
        type="text"
        value={userInput}
        onChange={(e) => setUserInput(e.target.value)}
        onKeyPress={(e) => e.key === "Enter" && onSubmit()}
        className="inline-block mx-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-[80px]"
        placeholder={`[${currentBlankAnswer.length} chars]`}
        autoFocus
      />
      <button
        onClick={onSubmit}
        className="inline-block ml-1 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
      >
        Go
      </button>

      {feedbackMessage && (
        <span
          className={`ml-2 font-medium ${
            feedbackMessage.includes("Correct")
              ? "text-green-400"
              : "text-red-400"
          }`}
        >
          {feedbackMessage}
        </span>
      )}
    </span>
  );
}