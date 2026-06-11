import { InternalEstimateItem } from "@/types";

export interface SuggestionItem {
  itemId: string;
  description: string;
}

/**
 * Computes the Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= a.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + 1   // substitution
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Returns fuzzy suggestion matches from the passed catalog for a given input.
 */
export function getFuzzySuggestions(
  input: string,
  masterItems: Record<string, InternalEstimateItem>,
  limit = 3
): SuggestionItem[] {
  if (!input) return [];

  const cleanedInput = input.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
  const inputTokens = cleanedInput.split(/\s+/).filter(Boolean);

  const candidates = Object.keys(masterItems).map((key) => {
    const item = masterItems[key];
    const cleanedDesc = item.description.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
    const cleanedId = item.itemId.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();

    // 1. Calculate token overlap count
    let overlaps = 0;
    inputTokens.forEach((token) => {
      if (cleanedDesc.includes(token) || cleanedId.includes(token)) {
        overlaps++;
      }
    });
    const tokenOverlapScore = inputTokens.length > 0 ? overlaps / inputTokens.length : 0;

    // 2. Levenshtein similarity on description
    const descDistance = levenshteinDistance(cleanedInput, cleanedDesc);
    const maxDescLength = Math.max(cleanedInput.length, cleanedDesc.length);
    const descSimilarity = maxDescLength > 0 ? 1 - descDistance / maxDescLength : 0;

    // 3. Levenshtein similarity on itemId
    const idDistance = levenshteinDistance(cleanedInput, cleanedId);
    const maxIdLength = Math.max(cleanedInput.length, cleanedId.length);
    const idSimilarity = maxIdLength > 0 ? 1 - idDistance / maxIdLength : 0;

    // Combined score weighted towards token overlap and description similarity
    const finalScore = tokenOverlapScore * 0.5 + descSimilarity * 0.4 + idSimilarity * 0.1;

    return {
      itemId: item.itemId,
      description: item.description,
      score: finalScore
    };
  });

  // Sort candidates by score descending and return limit
  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((c) => ({
      itemId: c.itemId,
      description: c.description
    }));
}
