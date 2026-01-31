#!/usr/bin/env node
/**
 * Build script to replace grunt-mokuai-coffee
 * Compiles CoffeeScript files and wraps them in a module system
 */

const fs = require('fs');
const path = require('path');
const coffee = require('coffee-script');

const srcDir = path.join(__dirname, '../src/syno');
const distFile = path.join(__dirname, '../dist/syno.js');

// Order matters for inheritance - base classes first
const fileOrder = [
  'API.coffee',
  'Auth.coffee',
  'AuthenticatedAPI.coffee',
  'Utils.coffee',
  'AudioStation.coffee',
  'DownloadStation.coffee',
  'DSM.coffee',
  'FileStation.coffee',
  'SurveillanceStation.coffee',
  'Syno.coffee',
  'VideoStation.coffee',
  'VideoStationDTV.coffee'
];

// Module names for generating accessors
const moduleNames = fileOrder.map(f => path.basename(f, '.coffee'));

// Generate module accessor declarations
// This replaces the with(modules) pattern that's not compatible with strict mode
const moduleAccessors = moduleNames.map(name =>
  `    var ${name} = { get value() { return modules.${name}; } };`
).join('\n');

// Mokuai module wrapper header - using getters instead of with statement
const header = `(function(){
    var modules = {};
    function setter(){ throw new Error('Cannot manually set module property'); }
    function setModule(name, factory){
        if(modules.hasOwnProperty(name)){
            throw new Error('Module '+name+' already exists.');
        }
        Object.defineProperty(modules, name, {
            get: function(){
                if(factory.busy) {
                    throw new Error('Cyclic dependency detected on module '+name);
                }
                factory.busy = true;
                var value = factory();
                Object.defineProperty(modules, name, {
                    value: value
                });
                factory.busy = false;
                return value;
            },
            set: setter,
            enumerable: true,
            configurable: true
        });
    }
    (function() {
      var extend1 = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
        hasProp = {}.hasOwnProperty;

`;

// Mokuai module wrapper footer
const footer = `
    }).call(this);

    if(typeof module !== 'undefined' && module.exports){
        module.exports = modules['Syno'];
    } else {
        this['Syno'] = modules['Syno'];
    }
}).call(this);
`;

function wrapModule(name, jsCode, allModuleNames) {
  // Replace direct references to other modules with modules.ModuleName
  // This is needed because we're not using 'with(modules)' anymore
  let processedCode = jsCode;

  // Replace class inheritance patterns and instantiation patterns
  for (const moduleName of allModuleNames) {
    if (moduleName !== name) {
      // Replace "extends ModuleName" pattern
      const extendsRegex = new RegExp(`(extends\\s+)(${moduleName})\\b`, 'g');
      processedCode = processedCode.replace(extendsRegex, '$1modules.$2');

      // Replace "(ModuleName)" pattern for extend1 calls (but not inside strings)
      // Only match when preceded by a non-quote character or start of line
      const extendCallRegex = new RegExp(`\\(${moduleName}\\)(?=;|,|\\s|$)`, 'g');
      processedCode = processedCode.replace(extendCallRegex, `(modules.${moduleName})`);

      // Replace "new ModuleName(" pattern for instantiation
      const newRegex = new RegExp(`\\bnew ${moduleName}\\(`, 'g');
      processedCode = processedCode.replace(newRegex, `new modules.${moduleName}(`);

      // Replace standalone ModuleName. references (e.g., Utils.something)
      // But NOT inside strings - only when preceded by whitespace, =, (, [, {, or start of line
      const staticRefRegex = new RegExp(`(^|[\\s=\\(\\[\\{,;])${moduleName}\\.`, 'g');
      processedCode = processedCode.replace(staticRefRegex, `$1modules.${moduleName}.`);
    }
  }

  // Indent the code
  const indentedCode = processedCode.split('\n').map(line => '          ' + line).join('\n');

  return `      setModule('${name}', function() {
        var exports, module;
        module = {};
        exports = module.exports = {};
        (function(modules, module, exports, setModule, setter) {
${indentedCode}
          return module.exports = ${name};
        })(modules, module, exports, void 0, void 0);
        return module.exports;
      });

`;
}

function compileCoffeeFile(filePath) {
  const coffeeCode = fs.readFileSync(filePath, 'utf8');

  // Compile CoffeeScript to JavaScript (bare mode, no wrapper)
  const jsCode = coffee.compile(coffeeCode, { bare: true });

  return jsCode;
}

function build() {
  console.log('Building syno.js...');

  let compiledModules = [];

  for (const fileName of fileOrder) {
    const filePath = path.join(srcDir, fileName);

    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      continue;
    }

    console.log(`  Compiling ${fileName}...`);

    const jsCode = compileCoffeeFile(filePath);
    const moduleName = path.basename(fileName, '.coffee');

    compiledModules.push(wrapModule(moduleName, jsCode, moduleNames));
  }

  // Combine all parts
  const output = header + compiledModules.join('') + footer;

  // Ensure dist directory exists
  const distDir = path.dirname(distFile);
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Write output
  fs.writeFileSync(distFile, output);

  console.log(`Build complete: ${distFile}`);
}

build();
