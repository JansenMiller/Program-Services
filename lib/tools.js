'use strict';
// The shortcut registry. To add a new tool: add an entry here and put its page under public/tools/<id>/.
// The server enforces `roles` on every request to the tool's path -- hiding a link is not the only protection.
const ROLES = ['supervisor', 'caseworker', 'chaplain'];

const TOOLS = [
  {
    id: 'certificates', icon: 'award', name: 'Certificates of Completion', status: 'live', href: '/tools/certificates/',
    description: 'Enter the program and date, paste a class roster, and print a Certificate of Completion for every participant.',
    roles: ['caseworker', 'supervisor'],
  },
  {
    id: 'reentry-report', icon: 'chart', name: 'Monthly Tracking Report', status: 'live', href: '/tools/reentry-report/',
    description: 'Fill in the monthly Statistical and Tracking Report, keep the Graduation Roster, and download the Excel file for your Regional Reentry Coordinator.',
    roles: ['caseworker', 'supervisor'],
    variants: { supervisor: { name: 'Tracking Reports', href: '/tools/reentry-report/all.html', description: 'See which facilities have turned in each month\'s report, and download any of them as Excel.' } },
  },
  {
    id: 'chapel-calendar', icon: 'calendar', name: 'Chapel Calendar', status: 'live', href: '/tools/chapel-calendar/',
    description: 'Build your facility\'s monthly chapel calendar with repeating services, then print it.',
    roles: ['chaplain', 'supervisor'],
    variants: { supervisor: { name: 'Chapel Calendars', href: '/tools/chapel-calendar/all.html', description: 'See every facility\'s calendar by month, sort by facility, and print any of them.' } },
  },
  {
    id: 'ideas', icon: 'spark', name: 'Shortcut Ideas', status: 'live', href: '/ideas.html',
    description: 'Tell Program Services about a time-consuming task you would like a shortcut for.',
    roles: ROLES,
  },
  {
    id: 'users', icon: 'users', name: 'Manage Team', status: 'live', href: '/admin/users.html',
    description: 'Add staff, assign roles, reset passwords, and turn accounts off.',
    roles: ['supervisor'],
  },
];

// A tool can present itself differently to a role (for example a different name and starting page).
const toolsFor = (role) => TOOLS.filter((t) => t.roles.includes(role)).map((t) => Object.assign({}, t, (t.variants && t.variants[role]) || {}));

// Which roles may load this path? null = any signed-in user.
function rolesForPath(p) {
  if (p.startsWith('/admin/')) return ['supervisor'];
  if (p.startsWith('/tools/')) {
    const t = TOOLS.find((x) => p.startsWith(x.href));
    return t ? t.roles : []; // unknown tool folder: nobody
  }
  return null;
}

module.exports = { ROLES, TOOLS, toolsFor, rolesForPath };
