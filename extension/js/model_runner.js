// model_runner.js - evaluate exported decision forest
function evalNode(node, features) {
  if (node.node_type === 'leaf') return node.prob_phish;
  const val = features[node.feature] ?? 0;
  if (val <= node.threshold) return evalNode(node.left, features);
  return evalNode(node.right, features);
}

function predictForest(modelJson, features) {
  let sum = 0.0;
  for (let i = 0; i < modelJson.trees.length; i++) {
    sum += evalNode(modelJson.trees[i], features);
  }
  return sum / modelJson.trees.length;
}
