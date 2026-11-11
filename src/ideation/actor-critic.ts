import type { IdeaVerification } from './ideation';

/** Actor proposes; critic scores independently (generator–verifier / actor–critic loop). */
export interface IdeaDebate {
  actorStance: 'proposed';
  criticVerdict: IdeaVerification['level'];
  disagrees: boolean;
}

export interface ActorCriticTelemetry {
  actorModel: string;
  criticModel: string;
  crossModel: boolean;
  total: number;
  disagreements: number;
  disagreementRate: number;
  disagreementPct: string;
}

export function ideaDebate(verification: IdeaVerification): IdeaDebate {
  return {
    actorStance: 'proposed',
    criticVerdict: verification.level,
    disagrees: verification.level !== 'Context supported',
  };
}

export function actorCriticTelemetry(
  actorModel: string,
  criticModel: string,
  verdicts: readonly IdeaVerification[],
): ActorCriticTelemetry {
  const total = verdicts.length;
  const disagreements = verdicts.filter((v) => v.level !== 'Context supported').length;
  const disagreementRate = total ? disagreements / total : 0;
  return {
    actorModel,
    criticModel,
    crossModel: actorModel.trim() !== criticModel.trim(),
    total,
    disagreements,
    disagreementRate,
    disagreementPct: `${Math.round(disagreementRate * 100)}%`,
  };
}
