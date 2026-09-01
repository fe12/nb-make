import { CommunityBrowser } from '@/components/community/CommunityBrowser';

export const metadata = { title: 'Community — nb-make' };

export default function CommunityPage() {
  // Public: readable without an account, which is the point of a community.
  return <CommunityBrowser />;
}
