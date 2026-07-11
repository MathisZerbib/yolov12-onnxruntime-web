import { Check, Clock, ShieldAlert } from 'lucide-react';

export function ChallengeTimeline() {
  return <section className="challenge-timeline"><div className="timeline-title"><ShieldAlert /><div><b>Settlement challenge</b><span>Proofs remain disputable before payout.</span></div></div><ol><li className="done"><Check /><span><b>Counting window</b><small>Authorized room operator</small></span></li><li className="active"><Clock /><span><b>Proof review</b><small>Evidence manifest published</small></span></li><li><span className="step-dot" /><span><b>Final settlement</b><small>After challenge period</small></span></li></ol></section>;
}
