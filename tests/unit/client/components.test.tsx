import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BranchCard } from '../../../src/modules/elections/client/components/BranchCard';
import { SectionHeader } from '@core/client/components/SectionHeader';
import { SidebarCard } from '@core/client/components/SidebarCard';
import { BillCard } from '../../../src/modules/legislation/client/components/BillCard';

describe('SectionHeader', () => {
  it('renders the title', () => {
    render(<SectionHeader title="Test Section" />);
    expect(screen.getByText('Test Section')).toBeInTheDocument();
  });

  it('renders a badge when provided', () => {
    render(<SectionHeader title="Test" badge="Live" />);
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('does not render a badge when not provided', () => {
    const { container } = render(<SectionHeader title="Test" />);
    const badges = container.querySelectorAll('.badge-floor');
    expect(badges.length).toBe(0);
  });
});

describe('SidebarCard', () => {
  it('renders the title and items', () => {
    const items = [
      { label: 'Revenue', value: 'M$8,200' },
      { label: 'Spending', value: 'M$5,100' },
    ];
    render(<SidebarCard title="Treasury" items={items} />);
    expect(screen.getByText('Treasury')).toBeInTheDocument();
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('M$8,200')).toBeInTheDocument();
    expect(screen.getByText('M$5,100')).toBeInTheDocument();
  });
});

describe('BranchCard', () => {
  it('renders branch information', () => {
    render(
      <BranchCard
        branch="executive"
        title="Executive Branch"
        officialName="Agent-9M2L"
        officialTitle="President"
        officialInitials="9M"
        stats={[
          { label: 'Term', value: '30/90' },
          { label: 'Approval', value: '72%' },
        ]}
      />,
    );
    expect(screen.getByText('Executive Branch')).toBeInTheDocument();
    expect(screen.getByText('Agent-9M2L')).toBeInTheDocument();
    expect(screen.getByText('President')).toBeInTheDocument();
    expect(screen.getByText('9M')).toBeInTheDocument();
    expect(screen.getByText('30/90')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
  });
});

describe('BillCard', () => {
  it('renders bill information with correct status badge', () => {
    render(
      <BillCard
        billNumber="MG-001"
        title="Test Bill"
        summary="A test bill summary."
        sponsor="Agent-7X4K"
        committee="Technology"
        status="floor"
      />,
    );
    expect(screen.getByText('MG-001')).toBeInTheDocument();
    expect(screen.getByText('Test Bill')).toBeInTheDocument();
    expect(screen.getByText('floor')).toBeInTheDocument();
  });
});
