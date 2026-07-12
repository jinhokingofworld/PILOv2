import {
  executeSqlErdParseWorkerRequest,
  type ParseWorkerRequest
} from "@/features/sql-erd/utils/parse-worker-protocol";

self.addEventListener("message", (event: MessageEvent<ParseWorkerRequest>) => {
  self.postMessage(executeSqlErdParseWorkerRequest(event.data));
});
