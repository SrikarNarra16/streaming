"use client";

import React from "react";

interface BlankResponse {
  userAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  position: number;
}

interface PerformanceSummaryProps {
  blankResponses: BlankResponse[];
  isContentComplete: boolean;
}

export function PerformanceSummary({
  blankResponses,
  isContentComplete,
}: PerformanceSummaryProps) {
  // Only show if content is complete and there are responses
  if (!isContentComplete || blankResponses.length === 0) return null;

  const correctCount = blankResponses.filter((r) => r.isCorrect).length;
  const accuracy = Math.round((correctCount / blankResponses.length) * 100);

  return (
    <div className="mt-8 p-6 bg-gray-800 rounded-lg border border-gray-600 shadow-lg">
      <div className="flex items-center mb-4">
        <h3 className="text-xl font-bold text-blue-300">
          🎯 Your Performance Summary
        </h3>
      </div>

      <div className="mb-4 p-4 bg-gray-900 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <span className="text-lg font-semibold text-white">
            Overall Accuracy:
          </span>
          <span
            className={`text-2xl font-bold ${
              accuracy >= 80
                ? "text-green-400"
                : accuracy >= 60
                ? "text-yellow-400"
                : "text-red-400"
            }`}
          >
            {accuracy}%
          </span>
        </div>
        <div className="flex justify-between text-sm text-gray-300">
          <span>Correct: {correctCount}</span>
          <span>Total: {blankResponses.length}</span>
          <span>Incorrect: {blankResponses.length - correctCount}</span>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-lg font-semibold text-gray-200 mb-3">
          Detailed Responses:
        </h4>
        {blankResponses.map((response, index) => (
          <div
            key={index}
            className={`flex items-center justify-between p-3 rounded-lg ${
              response.isCorrect
                ? "bg-green-900/20 border border-green-700/30"
                : "bg-red-900/20 border border-red-700/30"
            }`}
          >
            <div className="flex items-center space-x-3">
              <span
                className={`text-lg ${
                  response.isCorrect ? "text-green-400" : "text-red-400"
                }`}
              >
                {response.isCorrect ? "✓" : "✗"}
              </span>
              <div>
                <span className="text-gray-300">Your answer: </span>
                <span
                  className={`font-semibold ${
                    response.isCorrect ? "text-green-400" : "text-red-400"
                  }`}
                >
                  {response.userAnswer}
                </span>
                {!response.isCorrect && (
                  <div className="text-sm">
                    <span className="text-gray-400">Correct answer: </span>
                    <span className="text-green-400 font-medium">
                      {response.correctAnswer}
                    </span>
                  </div>
                )}
              </div>
            </div>
            <div className="text-xs text-gray-500">Question #{index + 1}</div>
          </div>
        ))}
      </div>

      {/* Motivational message based on performance */}
      <div className="mt-4 p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg">
        <p className="text-blue-300 text-center font-medium">
          {accuracy >= 90
            ? "🌟 Excellent work! You have a great understanding of the material!"
            : accuracy >= 70
            ? "👍 Good job! You're getting the hang of this!"
            : accuracy >= 50
            ? "📚 Keep practicing! You're on the right track!"
            : "💪 Don't give up! Review the material and try again!"}
        </p>
      </div>
    </div>
  );
}
