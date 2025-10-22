import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const diffText = process.argv[2];
const provider = process.argv[3];

if (!diffText || !provider) {
  console.error("Usage: node scripts/generate-release-notes.js '<diff>' '<provider>'");
  process.exit(1);
}

async function callOpenAI(prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4-turbo",
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.log('OpenAI Error Body:', errorBody);
    throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorBody}`);
  }

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

function groupDiffByRoutes(diffText) {
  const lines = diffText.split('\n');
  const chunks = new Map();
  
  let currentDiffContent = '';
  let insideModifiedSection = false;
  
  for (const line of lines) {
    // Remove debug logging for full run
    
    // File changes section (M/A files) - handle both tab and spaces
    if (line.match(/^\s*[MA]\s+/) && line.includes('routes/')) {
      const parts = line.trim().split('\t');
      const filePath = parts[1] || parts[0].substring(1).trim(); // Handle different formats
      
      // Extract route group: "cache/anthropic/routes/v1/skills/post.json" → "v1/skills"
      const routeMatch = filePath.match(/routes\/(.*?)\/[^/]+\.json$/);
      if (routeMatch) {
        const pathParts = routeMatch[1].split('/');
        const routeGroup = pathParts.length >= 2 
          ? `${pathParts[0]}/${pathParts[1]}` // "v1/skills"
          : routeMatch[1]; // fallback for shorter paths
        
        if (!chunks.has(routeGroup)) {
          chunks.set(routeGroup, {
            files: [],
            diffContent: `File changes:\n`
          });
        }
        chunks.get(routeGroup).files.push(filePath);
        chunks.get(routeGroup).diffContent += `${line}\n`;
      }
    }
    
    // Modified files details section
    if (line === 'Modified files details:') {
      insideModifiedSection = true;
      currentDiffContent = line + '\n';
      continue;
    }
    
    if (insideModifiedSection) {
      currentDiffContent += line + '\n';
      
      // Detect which route group this diff belongs to
      if (line.startsWith('diff --git') && line.includes('/routes/')) {
        const routeMatch = line.match(/routes\/(.*?)\/[^/]+\.json/);
        if (routeMatch) {
          const pathParts = routeMatch[1].split('/');
          const routeGroup = pathParts.length >= 2 
            ? `${pathParts[0]}/${pathParts[1]}`
            : routeMatch[1];
          
          if (chunks.has(routeGroup)) {
            chunks.get(routeGroup).diffContent += '\n' + currentDiffContent;
          }
          currentDiffContent = '';
        }
      }
    }
  }
  
  return chunks;
}

async function analyzeRouteGroup(routeGroup, chunk) {
  const prompt = `Analyze the following OpenAPI specification diff for route group "${routeGroup}" and return a JSON response with these fields:

1. "summary": Summary of changes as conventional commit message (max 100 characters)
2. "breaking_changes": Array of breaking changes (removed endpoints, parameters, or changed behavior)
3. "new_features": Array of new features (new endpoints, parameters, or options)  
4. "fixes": Array of fixes (documentation updates, typo corrections)
5. "version_type": The type of version change ("breaking", "feature", or "fix")

For each array item, include:
- "route": The affected route (e.g., "POST /v1/skills")
- "description": Brief description of the change

Diff for ${routeGroup}:
${chunk.diffContent.substring(0, 8000)} ${chunk.diffContent.length > 8000 ? '...(truncated)' : ''}

Return only valid JSON.`;

  return await callOpenAI(prompt);
}

async function combineAnalyses(analyses) {
  const allBreaking = [];
  const allFeatures = [];
  const allFixes = [];
  let highestVersionType = 'fix';

  for (const analysis of analyses) {
    allBreaking.push(...(analysis.breaking_changes || []));
    allFeatures.push(...(analysis.new_features || []));
    allFixes.push(...(analysis.fixes || []));
    
    // Determine highest version type
    if (analysis.version_type === 'breaking') highestVersionType = 'breaking';
    else if (analysis.version_type === 'feature' && highestVersionType !== 'breaking') {
      highestVersionType = 'feature';
    }
  }

  // Generate combined summary
  const summaryPrompt = `Create a single conventional commit message (max 100 characters) that summarizes these changes:

Breaking changes: ${allBreaking.length} items
New features: ${allFeatures.length} items  
Fixes: ${allFixes.length} items

Focus on the most significant changes. Return only the commit message as plain text.`;

  let summary;
  try {
    const summaryResponse = await callOpenAI(`${summaryPrompt}\n\nReturn JSON: {"summary": "your message here"}`);
    summary = summaryResponse.summary;
  } catch (error) {
    console.warn('Failed to generate summary, using fallback');
    summary = `feat: update ${provider} API specification`;
  }

  // Build markdown description
  let description = '';
  
  if (allBreaking.length > 0) {
    description += '### Breaking changes\n\n';
    allBreaking.forEach(item => {
      description += `- **${item.route}**: ${item.description}\n`;
    });
    description += '\n';
  }
  
  if (allFeatures.length > 0) {
    description += '### New features\n\n';
    allFeatures.forEach(item => {
      description += `- **${item.route}**: ${item.description}\n`;
    });
    description += '\n';
  }
  
  if (allFixes.length > 0) {
    description += '### Fixes\n\n';
    allFixes.forEach(item => {
      description += `- **${item.route}**: ${item.description}\n`;
    });
  }

  return {
    summary: summary.substring(0, 100),
    description: description.trim(),
    version: highestVersionType
  };
}

async function main() {
  try {
    console.log(`Analyzing diff for ${provider}...`);
    
    // Group diff by route
    const routeChunks = groupDiffByRoutes(diffText);
    console.log(`Found ${routeChunks.size} route groups:`, Array.from(routeChunks.keys()));
    
    if (routeChunks.size === 0) {
      throw new Error('No route changes detected in diff');
    }
    
    // Analyze each route group
    const analyses = [];
    for (const [routeGroup, chunk] of routeChunks) {
      console.log(`Analyzing route group: ${routeGroup} (${chunk.files.length} files)`);
      
      try {
        const analysis = await analyzeRouteGroup(routeGroup, chunk);
        analyses.push(analysis);
        console.log(`✓ Analyzed ${routeGroup}: ${analysis.version_type}`);
      } catch (error) {
        console.warn(`Failed to analyze ${routeGroup}:`, error.message);
        // Continue with other route groups
      }
    }
    
    if (analyses.length === 0) {
      throw new Error('No successful analyses completed');
    }
    
    // Combine all analyses
    console.log('Combining analyses...');
    const result = await combineAnalyses(analyses);
    
    // Output results for GitHub Actions
    console.log('Summary:', result.summary);
    console.log('Version:', result.version);
    console.log('\nDescription:');
    console.log(result.description);
    
    // Write outputs for GitHub Actions to consume
    const outputs = {
      summary: result.summary,
      description: result.description,
      version: result.version
    };
    
    await writeFile('release-notes-output.json', JSON.stringify(outputs, null, 2));
    console.log('\n✓ Release notes generated successfully');
    
  } catch (error) {
    console.error('Error generating release notes:', error.message);
    process.exit(1);
  }
}

main();