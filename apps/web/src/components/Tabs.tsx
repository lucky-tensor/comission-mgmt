/**
 * Tabs — reusable tabbed interface component.
 *
 * Manages tab state via local React state. Parent should handle URL sync if needed.
 * Each tab can be disabled independently.
 *
 * Usage:
 *   <Tabs defaultTab="dashboard" onTabChange={(tab) => {...}}>
 *     <Tabs.Tab id="dashboard" label="Dashboard" disabled={false}>
 *       <Dashboard />
 *     </Tabs.Tab>
 *     <Tabs.Tab id="settings" label="Settings">
 *       <Settings />
 *     </Tabs.Tab>
 *   </Tabs>
 */

import { useState, ReactNode, createContext, useContext, isValidElement, ReactElement } from 'react';

interface TabsContextType {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextType | null>(null);

interface TabProps {
  id: string;
  label: string;
  disabled?: boolean;
  children: ReactNode;
}

function Tab({ children }: TabProps) {
  return <>{children}</>;
}

interface TabsProps {
  defaultTab?: string;
  onTabChange?: (tab: string) => void;
  children: ReactNode;
}

export function Tabs({ defaultTab, onTabChange, children }: TabsProps) {
  const tabArray = (Array.isArray(children) ? children : [children]).filter(
    (child): child is ReactElement => isValidElement(child) && child.type === Tab,
  );

  const firstTabId = tabArray[0]?.props?.id || '';
  const [activeTab, setActiveTabState] = useState(defaultTab || firstTabId);

  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    onTabChange?.(tab);
  };

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div>
        {/* Tab list */}
        <div
          role="tablist"
          className="flex gap-1 border-b border-border px-0 mb-6"
          aria-label="Content tabs"
        >
          {tabArray.map((tab) => {
            const { id, label, disabled } = tab.props;
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                role="tab"
                aria-selected={isActive}
                aria-controls={`tabpanel-${id}`}
                id={`tab-${id}`}
                onClick={() => !disabled && setActiveTab(id)}
                disabled={disabled}
                className={[
                  'px-4 py-3 text-sm font-medium border-b-2 cursor-pointer transition-colors',
                  isActive
                    ? 'text-ink border-b-ink'
                    : 'text-ink-subtle border-b-transparent hover:text-ink hover:border-b-ink/30',
                  disabled ? 'opacity-50 cursor-not-allowed' : '',
                ].join(' ')}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {tabArray.map((tab) => {
          const { id } = tab.props;
          const isActive = activeTab === id;
          return (
            <div
              key={id}
              role="tabpanel"
              id={`tabpanel-${id}`}
              aria-labelledby={`tab-${id}`}
              hidden={!isActive}
            >
              {isActive && tab}
            </div>
          );
        })}
      </div>
    </TabsContext.Provider>
  );
}

Tabs.Tab = Tab;
