"use strict";

var _ = require('underscore');
var helper = require('slyn-util-helper');
var urlMatcherFactory = require('slyn-url-matcher-factory');

/**
 * Represents a state.
 * @constructor
 * @param {object} default - The default state
 */
var stateFactory = function(state) {
    var self = this;

    this.states = {};
    this.queue = [];
    this.defaultState = state || {};

    this.stateBuilder = {
        // Derive parent state from a hierarchical name only if 'parent' is not explicitly defined.
        // state.children = [];
        // if (parent) parent.children.push(state);
        parent: function(state) {
            if (helper.isDefined(state.parent) && state.parent) return self.findState(state.parent);
            // regex matches any valid composite state name
            // would match "contact.list" but not "contacts"
            var compositeName = /^(.+)\.[^.]+$/.exec(state.name);
            return compositeName ? self.findState(compositeName[1]) : self.root;
        },

        // inherit 'data' from parent and override by own values (if any)
        data: function(state) {
            if (state.parent && state.parent.data) {
                state.data = state.self.data = _.extend({}, state.parent.data, state.data);
            }
            return state.data;
        },

        // Build a URLMatcher if necessary, either via a relative or absolute URL
        url: function(state) {
            var url = state.url;

            if (helper.isString(url)) {
                if (url.charAt(0) == '^') {
                    return urlMatcherFactory.compile(url.substring(1));
                }
                return (state.parent.navigable || self.root).url.concat(url);
            }

            if (urlMatcherFactory.isMatcher(url) || url == null) {
                return url;
            }
            throw new Error("Invalid url '" + url + "' in state '" + state + "'");
        },

        // Keep track of the closest ancestor state that has a URL (i.e. is navigable)
        navigable: function(state) {
            return state.url ? state : (state.parent ? state.parent.navigable : null);
        },

        // Derive parameters for this state and ensure they're a super-set of parent's parameters
        params: function(state) {
            if (!state.params) {
                return state.url ? state.url.parameters() : state.parent.params;
            }
            if (!isArray(state.params)) throw new Error("Invalid params in state '" + state + "'");
            if (state.url) throw new Error("Both params and url specicified in state '" + state + "'");
            return state.params;
        },

        // If there is no explicit multi-view configuration, make one up so we don't have
        // to handle both cases in the view directive later. Note that having an explicit
        // 'views' property will mean the default unnamed view properties are ignored. This
        // is also a good time to resolve view names to absolute names, so everything is a
        // straight lookup at link time.
        views: function(state) {
            var views = {};

            _.each(helper.isDefined(state.views) ? state.views : {
                '': state
            }, function(view, name) {
                if (name.indexOf('@') < 0) name += '@' + state.parent.name;
                views[name] = view;
            });
            return views;
        },

        ownParams: function(state) {
            if (!state.parent) {
                return state.params;
            }
            var paramNames = {};
            _.each(state.params, function(p) {
                paramNames[p] = true;
            });

            _.each(state.parent.params, function(p) {
                if (!paramNames[p]) {
                    throw new Error("Missing required parameter '" + p + "' in state '" + state.name + "'");
                }
                paramNames[p] = false;
            });
            var ownParams = [];

            _.each(paramNames, function(own, p) {
                if (own) ownParams.push(p);
            });
            return ownParams;
        },

        // Keep a full path from the root down to this state as this is needed for state activation.
        path: function(state) {
            return state.parent ? state.parent.path.concat(state) : []; // exclude root from path
        },

        // Speed up $state.contains() as it's used a lot
        includes: function(state) {
            var includes = state.parent ? _.extend({}, state.parent.includes) : {};
            includes[state.name] = true;
            return includes;
        },

        delegates: {}
    };

    this.root = this.registerState({
        name: '',
        url: '^',
        views: null,
        'abstract': true
    });

    this.root.navigable = null;
}

stateFactory.prototype.isRelative = function(stateName) {
    return stateName.indexOf(".") === 0 || stateName.indexOf("^") === 0;
};

stateFactory.prototype.queueState = function(parentName, state) {
    if (!this.queue[parentName]) {
        this.queue[parentName] = [];
    }

    this.queue[parentName].push(state);
}

/**
 * Creates a new state
 * @param {String} name - name of the state
 * @param {object} options - info for the state
 * @param {String} options.url - the url of the state
 * @param {String} options.templateUrl - the filepath for the template of a state
 * @param {String} options.controller - the filepath for the controller of a state
 *
 * @param {object} options.views - all subviews of a state
 */
stateFactory.prototype.state = function(name, definition) {
    /*
    TODO remove this part

    var state = {};

    if(!name)
      throw new Error('stateFactory : a state must have a name');

    if(!options)
      throw new Error('stateFactory : missing options {url, templateUrl and controller} ');

    if(!Object.prototype.hasOwnProperty.call(options, 'url'))
      throw new Error('stateFactory : missing options.url');

    // call registerState here
    state[name] = options;
    this.states.push(state);

    return this;*/

    /*jshint validthis: true */
    if (helper.isObject(name)) definition = name;
    else definition.name = name;
    this.registerState(definition);

    return this;
};

stateFactory.prototype.registerState = function(state) {

    var name = state.name;
    if (!helper.isString(name) || name.indexOf('@') >= 0) throw new Error("State must have a valid name");
    if (this.states.hasOwnProperty(name)) throw new Error("State '" + name + "'' is already defined");

    // Get parent name
    var parentName = (name.indexOf('.') !== -1) ? name.substring(0, name.lastIndexOf('.')) : (helper.isString(state.parent)) ? state.parent : '';

    // If parent is not registered yet, add state to queue and register later
    if (parentName && !this.states[parentName]) {
        return this.queueState(parentName, state);
    }

    for (var key in this.stateBuilder) {
        if (helper.isFunction(this.stateBuilder[key])) state[key] = this.stateBuilder[key](state, this.stateBuilder.delegates[key]);
    }

    this.states[name] = state;

    // this part goes in core.init TODO
    /*if (!state[abstractKey] && state.url) {
      $urlRouterProvider.when(state.url, ['$match', '$stateParams', function ($match, $stateParams) {
        if ($state.$current.navigable != state || !equalForKeys($match, $stateParams)) {
          $state.transitionTo(state, $match, { location: false });
        }
      }]);
    }*/

    // Register any queued children
    if (this.queue[name]) {
        for (var i = 0; i < this.queue[name].length; i++) {
            this.registerState(this.queue[name][i]);
        }
    }

    return state;
};

stateFactory.prototype.findState = function(stateOrName, base) {
    var isStr = helper.isString(stateOrName),
        name = isStr ? stateOrName : stateOrName.name,
        path = this.isRelative(name);

    if (path) {
        if (!base) throw new Error("No reference point given for path '" + name + "'");
        var rel = name.split("."),
            i = 0,
            pathLength = rel.length,
            current = base;

        for (; i < pathLength; i++) {
            if (rel[i] === "" && i === 0) {
                current = base;
                continue;
            }
            if (rel[i] === "^") {
                if (!current.parent) throw new Error("Path '" + name + "' not valid for state '" + base.name + "'");
                current = current.parent;
                continue;
            }
            break;
        }
        rel = rel.slice(i).join(".");
        name = current.name + (current.name && rel ? "." : "") + rel;
    }

    var state = this.states[name];

    if (state && (isStr || (!isStr && (state === stateOrName || state.self === stateOrName)))) {
        return state;
    }
    return undefined;
}

module.exports = {
    create: function(param) {
        return new stateFactory(param);
    }
};
