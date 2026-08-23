const fs = require('fs');
const path = require('path');

const gccFile = path.join(process.cwd(), 'src', 'components', 'admin', 'OperationsOS', 'GroupControlCenter.tsx');
let gccContent = fs.readFileSync(gccFile, 'utf8');

gccContent = gccContent.replace("setGroups(data as OpsGroup[]);", "setGroups(data as unknown as OpsGroup[]);");
gccContent = gccContent.replace("setSelectedGroup(data[0] as OpsGroup);", "setSelectedGroup(data[0] as unknown as OpsGroup);");

fs.writeFileSync(gccFile, gccContent, 'utf8');
