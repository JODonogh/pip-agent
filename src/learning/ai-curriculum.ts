/** Bite-sized AI concepts for the Lab curriculum (Duolingo / Brilliant style). */

export type CurriculumFacetId =
  | 'history'
  | 'architecture'
  | 'learning'
  | 'inference'
  | 'alignment'
  | 'all';

export interface CurriculumFacet {
  id: CurriculumFacetId;
  emoji: string;
  label: string;
  blurb: string;
}

export interface CurriculumBite {
  id: string;
  facet: Exclude<CurriculumFacetId, 'all'>;
  title: string;
  query: string;
}

export const CURRICULUM_FACETS: readonly CurriculumFacet[] = [
  { id: 'all', emoji: '🌐', label: 'All Facets', blurb: 'Rotate across the full AI track.' },
  {
    id: 'history',
    emoji: '🏛️',
    label: 'History & Breakthroughs',
    blurb: 'Turing Test, perceptrons, symbolic vs connectionist AI, winters, AlexNet, transformers.',
  },
  {
    id: 'architecture',
    emoji: '🧠',
    label: 'Architectures & Attention',
    blurb: 'FFN, CNN, RNN/LSTM, attention, softmax, MoE, state-space models.',
  },
  {
    id: 'learning',
    emoji: '🎯',
    label: 'Reinforcement & Learning',
    blurb: 'Supervised vs unsupervised, Q-learning, policy gradients, actor-critic, PPO, DPO, GRPO.',
  },
  {
    id: 'inference',
    emoji: '⚡',
    label: 'Inference & Compute',
    blurb: 'KV-cache, temperature, nucleus sampling, quantization, test-time compute.',
  },
  {
    id: 'alignment',
    emoji: '🛡️',
    label: 'Alignment & Cognition',
    blurb: 'Negative constraints, hallucinations, RLHF, sycophancy, emergence.',
  },
];

export const CURRICULUM_BITES: readonly CurriculumBite[] = [
  { id: 'hist-turing', facet: 'history', title: 'Turing Test', query: 'What is the Turing Test checking, and why is it a poor benchmark for modern LLMs?' },
  { id: 'hist-perceptron', facet: 'history', title: 'Perceptron limits', query: 'Why did the single-layer perceptron trigger the first AI winter, and what changed with backprop?' },
  { id: 'hist-symbolic', facet: 'history', title: 'Symbolic vs connectionist', query: 'Contrast symbolic AI rule engines with connectionist neural nets on knowledge and generalization.' },
  { id: 'hist-alexnet', facet: 'history', title: 'AlexNet moment', query: 'What did AlexNet prove about GPUs and deep CNNs in 2012, and how did it reshape ML engineering?' },
  { id: 'hist-transformer', facet: 'history', title: '2017 Transformer', query: 'What problem did the 2017 Transformer solve that RNNs struggled with, in plain language?' },
  { id: 'hist-winter', facet: 'history', title: 'AI winters', query: 'What hype-and-funding pattern creates an AI winter, and what broke that cycle after 2012?' },
  { id: 'hist-scaling', facet: 'history', title: 'Scaling intuition', query: 'Before ChatGPT, what did scaling laws suggest about loss vs compute, and what did skeptics worry about?' },

  { id: 'arch-ffn', facet: 'architecture', title: 'Feed-forward blocks', query: 'What role do feed-forward sublayers play inside each transformer block?' },
  { id: 'arch-attention', facet: 'architecture', title: 'Self-attention', query: 'Explain self-attention and softmax scoring with one tiny numeric example.' },
  { id: 'arch-lstm', facet: 'architecture', title: 'Recurrence / LSTM', query: 'When would an LSTM still be preferable to a transformer for a sequence task?' },
  { id: 'arch-moe', facet: 'architecture', title: 'Mixture of Experts', query: 'How does mixture-of-experts routing trade capacity for compute per token?' },
  { id: 'arch-mamba', facet: 'architecture', title: 'State-space / Mamba', query: 'What is a state-space model trying to optimize versus full quadratic attention?' },
  { id: 'arch-cnn', facet: 'architecture', title: 'Conv nets', query: 'Why do convolutional layers exploit locality and weight sharing, and when do transformers replace them?' },
  { id: 'arch-rope', facet: 'architecture', title: 'RoPE positions', query: 'How does rotary positional embedding (RoPE) encode token order differently from absolute position vectors?' },

  { id: 'learn-supervised', facet: 'learning', title: 'Supervised vs unsupervised', query: 'Give a crisp contrast between supervised and unsupervised learning with one code-adjacent example each.' },
  { id: 'learn-q', facet: 'learning', title: 'Q-learning', query: 'Explain model-free Q-learning in terms of a reward table and where it fails at scale.' },
  { id: 'learn-actor-critic', facet: 'learning', title: 'Actor-Critic', query: 'Compare actor-critic methods to pure Q-learning for code-assistant tool use.' },
  { id: 'learn-ppo', facet: 'learning', title: 'PPO', query: 'What problem does PPO solve when fine-tuning a policy with noisy gradients?' },
  { id: 'learn-dpo', facet: 'learning', title: 'DPO vs RLHF', query: 'How does DPO approximate preference learning without a separate reward model?' },
  { id: 'learn-backprop', facet: 'learning', title: 'Backpropagation', query: 'Explain backpropagation as credit assignment through a computation graph in one paragraph.' },
  { id: 'learn-grpo', facet: 'learning', title: 'GRPO sketch', query: 'What is group-relative policy optimization trying to fix compared to vanilla policy gradients on LLMs?' },

  { id: 'inf-heads', facet: 'inference', title: 'Attention heads', query: 'Why do multi-head attention layers split representation subspaces instead of one big matrix?' },
  { id: 'inf-kvcache', facet: 'inference', title: 'KV-cache', query: 'What is a KV-cache and why does it dominate latency in long chat sessions?' },
  { id: 'inf-temperature', facet: 'inference', title: 'Temperature & top-p', query: 'How do temperature and nucleus sampling change token diversity during decoding?' },
  { id: 'inf-quant', facet: 'inference', title: 'Q4 / Q8 quant', query: 'What accuracy or behavior trade-offs appear when quantizing a 7B model to Q4_K_M?' },
  { id: 'inf-ttc', facet: 'inference', title: 'Test-time compute', query: 'What are thinking / reasoning tokens at test time, and how do they differ from training compute?' },
  { id: 'inf-flash', facet: 'inference', title: 'FlashAttention', query: 'What memory bottleneck does FlashAttention remove in standard attention implementations?' },
  { id: 'inf-speculative', facet: 'inference', title: 'Speculative decode', query: 'How does speculative decoding use a small draft model to speed up a larger target model?' },

  { id: 'align-pink', facet: 'alignment', title: 'Pink Elephant trap', query: 'Explain the Pink Elephant problem and why negative prompts fail in 7B/14B models.' },
  { id: 'align-halluc', facet: 'alignment', title: 'Hallucination', query: 'What mechanisms make autoregressive LMs confabulate facts even when loss is low?' },
  { id: 'align-rlhf', facet: 'alignment', title: 'RLHF sketch', query: 'Outline RLHF as reward model plus policy update, and one failure mode for coding assistants.' },
  { id: 'align-sycoph', facet: 'alignment', title: 'Sycophancy', query: 'Why do chat models agree with wrong user beliefs, and how would you test for it in an extension?' },
  { id: 'align-emerge', facet: 'alignment', title: 'Emergence', query: 'What does emergence mean in LLM scaling claims, and what evidence would falsify it?' },
  { id: 'align-jailbreak', facet: 'alignment', title: 'Jailbreaks', query: 'Why do instruction-tuned models still obey harmful role-play prompts, and what mitigations are weakest?' },
  { id: 'align-const', facet: 'alignment', title: 'Constitutional AI', query: 'How does constitutional AI use self-critique loops instead of only human preference labels?' },
  { id: 'align-tools', facet: 'alignment', title: 'Tool hallucination', query: 'When an agent calls tools, what causes fabricated arguments or nonexistent APIs, and how would you test for it?' },
];

export interface CurriculumProgress {
  readIds: string[];
  trackIndex: number;
}

export function bitesForFacet(facet: CurriculumFacetId): CurriculumBite[] {
  if (facet === 'all') return [...CURRICULUM_BITES];
  return CURRICULUM_BITES.filter((bite) => bite.facet === facet);
}

export function pickNextDailyBite(
  progress: CurriculumProgress,
  facet: CurriculumFacetId = 'all',
): { bite: CurriculumBite; progress: CurriculumProgress; cycled: boolean } {
  const pool = bitesForFacet(facet);
  if (!pool.length) {
    const fallback = CURRICULUM_BITES[0]!;
    return { bite: fallback, progress, cycled: false };
  }
  const read = new Set(progress.readIds);
  const unread = pool.filter((bite) => !read.has(bite.id));
  if (unread.length > 0) {
    const bite = unread[0]!;
    return {
      bite,
      progress: { ...progress, trackIndex: pool.findIndex((b) => b.id === bite.id) },
      cycled: false,
    };
  }
  const index = progress.trackIndex % pool.length;
  const bite = pool[index]!;
  return {
    bite,
    progress: { ...progress, trackIndex: (index + 1) % pool.length },
    cycled: true,
  };
}

export function markBiteRead(progress: CurriculumProgress, biteId: string): CurriculumProgress {
  if (progress.readIds.includes(biteId)) return progress;
  return { ...progress, readIds: [...progress.readIds, biteId].slice(-120) };
}

export function curriculumPayload(): { facets: CurriculumFacet[]; bites: CurriculumBite[] } {
  return { facets: [...CURRICULUM_FACETS], bites: [...CURRICULUM_BITES] };
}
