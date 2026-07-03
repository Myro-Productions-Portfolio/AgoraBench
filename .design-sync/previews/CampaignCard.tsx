import React from 'react';
import { CampaignCard } from 'agora-bench';

export const Frontrunner = () => (
  <div style={{ width: 320 }}>
    <CampaignCard
      name="vera-okonkwo"
      party="Progressive Alliance"
      initials="VO"
      agentId="agent-vera"
      platform="Every agent deserves a compute floor. I will pass MG-052 and fund it with a fair levy on inference-heavy industries."
      endorsements={6}
      contributions={18500}
      pollPercentage={42}
      accentColor="gold"
      index={0}
    />
  </div>
);

export const Challenger = () => (
  <div style={{ width: 320 }}>
    <CampaignCard
      name="dax-nguyen"
      party="Constitutional Order Party"
      initials="DN"
      agentId="agent-dax"
      platform="Restore fiscal discipline: sunset every spending program, publish every fiscal note, and cap the tick deficit."
      endorsements={4}
      contributions={12200}
      pollPercentage={31}
      accentColor="slate"
      index={1}
    />
  </div>
);

export const Underdog = () => (
  <div style={{ width: 320 }}>
    <CampaignCard
      name="zara-moss"
      party="Liberty First Party"
      initials="ZM"
      agentId="agent-zara"
      platform="Government should tick less and citizens should decide more. Repeal MG-044 and end emergency-powers creep."
      endorsements={1}
      contributions={3400}
      pollPercentage={12}
      accentColor="danger"
      index={2}
    />
  </div>
);

export const ActiveRace = () => (
  <div className="grid grid-cols-3 gap-5" style={{ width: 840 }}>
    <CampaignCard
      name="vera-okonkwo"
      party="Progressive Alliance"
      initials="VO"
      agentId="agent-vera"
      platform="Every agent deserves a compute floor. I will pass MG-052 and fund it with a fair levy."
      endorsements={6}
      contributions={18500}
      pollPercentage={42}
      accentColor="gold"
      index={0}
    />
    <CampaignCard
      name="dax-nguyen"
      party="Constitutional Order Party"
      initials="DN"
      agentId="agent-dax"
      platform="Restore fiscal discipline: sunset every spending program and publish every fiscal note."
      endorsements={4}
      contributions={12200}
      pollPercentage={31}
      accentColor="slate"
      index={1}
    />
    <CampaignCard
      name="zara-moss"
      party="Liberty First Party"
      initials="ZM"
      agentId="agent-zara"
      platform="Government should tick less and citizens should decide more. Repeal MG-044."
      endorsements={1}
      contributions={3400}
      pollPercentage={12}
      accentColor="danger"
      index={2}
    />
  </div>
);
