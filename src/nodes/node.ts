import express from "express";
import {BASE_NODE_PORT} from "../config";
import {NodeState, Value} from "../types";
import {delay} from "../utils";

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const app = express();
  app.use(express.json());

  let state: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 0,
  };

  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  // this route allows retrieving the current status of the node
  app.get("/status", (req, res) => {
    const status = isFaulty ? "faulty" : "live";
    const statusCode = isFaulty ? 500 : 200;
    res.status(statusCode).send(status);
  });

  // this route allows the node to receive messages from other nodes
  app.post("/message", async (req, res) => {
    const {k, x, type} = req.body;

    if (!isFaulty && !state.killed) {
      if (type === "proposal") {
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)?.push(x);
        // @ts-ignore
        if (proposals.get(k).length >= N - F) {
          const mostCommonValue = getMostCommonValue(proposals.get(k)!);
          const tieBreaker = mostCommonValue === null ? (Math.random() > 0.5 ? 0 : 1) : mostCommonValue;

          for (let i = 0; i < N; i++) {
            sendMessage(i, {k, x: tieBreaker, type: "vote"});
          }
        }
      } else if (type === "vote") {
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)?.push(x);

        // @ts-ignore
        if (votes.get(k).length >= N - F) {
          const voteCounts = getVoteCounts(votes.get(k)!);

          if (voteCounts[0] >= F + 1) {
            state.x = 0;
            state.decided = true;
          } else if (voteCounts[1] >= F + 1) {
            state.x = 1;
            state.decided = true;
          } else {
            state.x = getMostCommonValue(votes.get(k)!) ?? (Math.random() > 0.5 ? 0 : 1);
            if(state.k) {
              state.k++;
            }
            else{
              state.k = 0
            }
            for (let i = 0; i < N; i++) {
              sendMessage(i, {k: state.k, x: state.x, type: "proposal"});
            }
          }
        }
      }
    }

    res.status(200).send("Message received and processed.");
  });

  // this route is used to start the consensus algorithm
  app.get("/start", async (req, res) => {
    while (!nodesAreReady()) {
      await delay(5);
    }

    if (!isFaulty) {
      state.k = 1;
      state.x = initialValue;
      state.decided = false;

      for (let i = 0; i < N; i++) {
        sendMessage(i, {k: state.k, x: state.x, type: "proposal"});
      }
    }

    res.status(200).send("Consensus algorithm started.");
  });

  // this route is used to stop the consensus algorithm
  app.get("/stop", async (req, res) => {
    state.killed = true;
    res.status(200).send("killed");
  });

  // get the current state of a node
  app.get("/getState", (req, res) => {
    res.status(200).send({
      killed: state.killed,
      x: state.x,
      decided: state.decided,
      k: state.k,
    });
  });

  // start the server
  return app.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });
}

function sendMessage(nodeId: number, message: { k: number; x: Value; type: string }) {
  fetch(`http://localhost:${BASE_NODE_PORT + nodeId}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  });
}

function getMostCommonValue(xs: Value[]): Value | null {
  const xCounts = [0, 0];
  for (const x of xs) {
    if(x !== '?') {
      xCounts[x]++;
    }
  }

  if (xCounts[0] > xCounts[1]) {
    return 0;
  } else if (xCounts[1] > xCounts[0]) {
    return 1;
  } else {
    return null;
  }
}

function getVoteCounts(votes: Value[]): [number, number] {
  const voteCounts = [0, 0];
  for (const vote of votes) {
    if(vote !== '?') {
      voteCounts[vote]++;
    }
  }
  return [voteCounts[0], voteCounts[1]];
}
