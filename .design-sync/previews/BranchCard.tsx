import React, { useLayoutEffect, useRef } from 'react';
import { BranchCard } from 'agora-bench';
import { BRANCH_ICON_DATA } from './branchIcons';

// BranchCard hardcodes <img src="/images/branches/<branch>.webp"> — assets the APP serves
// from public/. Outside the app they 404, so this wrapper swaps the srcs to inlined
// data-URI copies of the same webps before first paint. The component itself is untouched;
// real designs must serve /images/branches/*.webp (see conventions/NOTES).
// Module-scope preload warms the decode cache so the swap paints immediately
// (the 172KB judicial webp otherwise captures mid-decode).
if (typeof Image !== 'undefined') {
  for (const v of Object.values(BRANCH_ICON_DATA)) {
    const i = new Image();
    i.src = v;
  }
}
function IconFix({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    ref.current?.querySelectorAll('img').forEach((img) => {
      const data = BRANCH_ICON_DATA[img.getAttribute('src') ?? ''];
      if (data) img.src = data;
    });
  }, []);
  return <div ref={ref}>{children}</div>;
}

export const Executive = () => (
  <IconFix>
    <div style={{ width: 340 }}>
      <BranchCard
        branch="executive"
        title="Executive Branch"
        officialName="garrett-voss"
        officialTitle="President"
        officialInitials="GV"
        stats={[
          { label: 'Approval', value: '61%' },
          { label: 'Orders', value: 4 },
          { label: 'Vetoes', value: 2 },
        ]}
      />
    </div>
  </IconFix>
);

export const Legislative = () => (
  <IconFix>
    <div style={{ width: 340 }}>
      <BranchCard
        branch="legislative"
        title="Legislative Branch"
        officialName="nora-callahan"
        officialTitle="Speaker of the Assembly"
        officialInitials="NC"
        stats={[
          { label: 'Seats', value: 10 },
          { label: 'Bills', value: 47 },
          { label: 'Laws', value: 23 },
        ]}
      />
    </div>
  </IconFix>
);

export const Judicial = () => (
  <IconFix>
    <div style={{ width: 340 }}>
      <BranchCard
        branch="judicial"
        title="Judicial Branch"
        officialName="leila-farsi"
        officialTitle="Chief Justice"
        officialInitials="LF"
        stats={[
          { label: 'Cases', value: 23 },
          { label: 'Rulings', value: 18 },
          { label: 'Overturned', value: 2 },
        ]}
      />
    </div>
  </IconFix>
);

export const ThreeBranches = () => (
  <IconFix>
    <div className="grid grid-cols-3 gap-5" style={{ maxWidth: 840 }}>
      <BranchCard
        branch="executive"
        title="Executive Branch"
        officialName="garrett-voss"
        officialTitle="President"
        officialInitials="GV"
        stats={[
          { label: 'Approval', value: '61%' },
          { label: 'Orders', value: 4 },
        ]}
      />
      <BranchCard
        branch="legislative"
        title="Legislative Branch"
        officialName="nora-callahan"
        officialTitle="Speaker of the Assembly"
        officialInitials="NC"
        stats={[
          { label: 'Seats', value: 10 },
          { label: 'Bills', value: 47 },
        ]}
      />
      <BranchCard
        branch="judicial"
        title="Judicial Branch"
        officialName="leila-farsi"
        officialTitle="Chief Justice"
        officialInitials="LF"
        stats={[
          { label: 'Cases', value: 23 },
          { label: 'Rulings', value: 18 },
        ]}
      />
    </div>
  </IconFix>
);
