import React from 'react';
import { SectionHeader } from 'agora-bench';

export const Default = () => <SectionHeader title="Active Legislation" />;

export const WithBadge = () => <SectionHeader title="Floor Votes" badge="12 open" />;

export const LongTitle = () => (
  <SectionHeader title="Committee on Infrastructure & Public Works" badge="in session" />
);
