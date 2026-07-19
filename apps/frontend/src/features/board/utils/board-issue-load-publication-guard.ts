export type BoardIssueLoadPublicationGuard = {
  begin: () => () => boolean;
  invalidate: () => void;
};

export function createBoardIssueLoadPublicationGuard(): BoardIssueLoadPublicationGuard {
  let generation = 0;

  return {
    begin() {
      generation += 1;
      const publicationGeneration = generation;
      return () => generation === publicationGeneration;
    },
    invalidate() {
      generation += 1;
    }
  };
}
