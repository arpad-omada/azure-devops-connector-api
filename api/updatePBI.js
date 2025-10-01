export default async function handler(req, res) {
  const { taskId, personalAccessToken } = req.query;

  if (!taskId || !personalAccessToken) {
    return res.status(400).json({ error: 'Missing taskId or personalAccessToken' });
  }

  const AZURE_ORG = 'IdentityPlatform';
  const AZURE_PROJECT = 'Product%20Backlog';
  const API_VERSION = '6.0';
  const authHeader = 'Basic ' + Buffer.from(':' + personalAccessToken).toString('base64');

  try {
    const fetchAzure = async (url, method = 'GET', body = null) => {
      const options = {
        method,
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json-patch+json'
        }
      };
      if (body) options.body = JSON.stringify(body);
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`Azure DevOps API error: ${response.status}`);
      return await response.json();
    };

    const taskUrl = `https://dev.azure.com/${AZURE_ORG}/${AZURE_PROJECT}/_apis/wit/workitems/${taskId}?$expand=relations&api-version=${API_VERSION}`;
    const taskData = await fetchAzure(taskUrl);

    const parentRel = (taskData.relations || []).find(r => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
    if (!parentRel) throw new Error('Parent PBI not found');
    const parentId = parentRel.url.split('/').pop();

    const parentUrl = `https://dev.azure.com/${AZURE_ORG}/${AZURE_PROJECT}/_apis/wit/workitems/${parentId}?$expand=relations&api-version=${API_VERSION}`;
    const parentData = await fetchAzure(parentUrl);

    const childRels = (parentData.relations || []).filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward');

    let totalRemainingWork = 0;
    let allDone = true;

    for (const rel of childRels) {
      const childId = rel.url.split('/').pop();
      const childUrl = `https://dev.azure.com/${AZURE_ORG}/${AZURE_PROJECT}/_apis/wit/workitems/${childId}?api-version=${API_VERSION}`;
      const childData = await fetchAzure(childUrl);
      const fields = childData.fields;
      const state = fields['System.State'];
      const remainingWork = fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0;

      if (state !== 'Done') {
        allDone = false;
        totalRemainingWork += Math.round(remainingWork);
      }
    }

    let effort = totalRemainingWork === 0 ? 0 : Math.ceil(totalRemainingWork / 6);
    const patchBody = [
      {
        op: 'add',
        path: '/fields/Microsoft.VSTS.Scheduling.Effort',
        value: effort
      }
    ];

    if (allDone) {
      patchBody.push({
        op: 'add',
        path: '/fields/System.State',
        value: 'Done'
      });
    }

    const updateUrl = `https://dev.azure.com/${AZURE_ORG}/${AZURE_PROJECT}/_apis/wit/workitems/${parentId}?api-version=${API_VERSION}`;
    await fetchAzure(updateUrl, 'PATCH', patchBody);

    res.status(200).json({ message: 'Parent PBI updated successfully', effort, allDone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
